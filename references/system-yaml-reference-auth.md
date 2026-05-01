# Referencia de autenticación saliente — bloque `auth`

> **Alcance:** este documento describe el comportamiento **real y verificado** del generador
> para el bloque `auth` de integraciones HTTP salientes. Documenta qué código se produce,
> qué validaciones se aplican, y qué gaps existen para futuras mejoras.
>
> Fuentes verificadas:
> - `templates/infrastructure/adapters/OutboundFeignConfig.java.ejs`
> - `templates/infrastructure/adapters/external/ExternalRestConfig.java.ejs`
> - `templates/shared/infrastructure/auth/OAuth2ClientCredentialsSupport.java.ejs`
> - `src/utils/resilience-auth-resolver.js`
> - `src/utils/integration-validator.js`
> - `src/generators/base-project-generator.js`
> - `templates/base/gradle/build.gradle.ejs`

---

## Tabla de contenidos

1. [Dónde puede declararse `auth`](#1-dónde-puede-declararse-auth)
2. [Precedencia y resolución](#2-precedencia-y-resolución)
3. [Tipos soportados y código generado](#3-tipos-soportados-y-código-generado)
   - 3.1 [`type: api-key`](#31-type-api-key)
   - 3.2 [`type: bearer`](#32-type-bearer)
   - 3.3 [`type: oauth2-cc`](#33-type-oauth2-cc)
   - 3.4 [`type: mTLS`](#34-type-mtls)
   - 3.5 [`type: internal-jwt`](#35-type-internal-jwt)
   - 3.6 [`type: none` o ausencia](#36-type-none-o-ausencia)
4. [Validaciones activas (INT-015)](#4-validaciones-activas-int-015)
5. [Artefactos generados por tipo — resumen](#5-artefactos-generados-por-tipo--resumen)
6. [Gaps identificados](#6-gaps-identificados)

---

## 1. Dónde puede declararse `auth`

El bloque `auth` puede aparecer en tres ubicaciones:

| Ubicación | Aplica a |
|---|---|
| `system.yaml#/integrations[].auth` | Integración BC→BC (`customer-supplier, channel: http`) |
| `system.yaml#/externalSystems[].auth` | Sistema externo (usado por `pattern: acl, channel: http`) |
| `{bc}.yaml#/integrations/outbound[name=X].auth` | Override por BC de cualquiera de los anteriores |

> **`infrastructure.integrations.defaults.auth`** es un campo documentado en los skills de
> diseño pero **no está implementado en el generador**. El resolver (`resilience-auth-resolver.js`)
> no lee esa sección. Ver [GAP-AUTH-007](#gap-auth-007--infrastructure-integrations-defaults-no-implementado).

---

## 2. Precedencia y resolución

El resolver (`resolveAuthForBcHttp` / `resolveAuthForExternal` en `resilience-auth-resolver.js`)
aplica la siguiente precedencia usando `pickFirst()` — devuelve el primer objeto no-vacío:

```
bc.yaml#/integrations/outbound[name=target].auth   ← override (máxima prioridad)
  ↓ si ausente o vacío
system.yaml#/integrations[from=bc, to=target, channel=http].auth   ← BC→BC
  o
system.yaml#/externalSystems[name=target].auth                     ← externo
```

El objeto resuelto se pasa entero al template como variable `auth`. Si `auth` es `null` (nada
declarado en ningún nivel), el template no genera ningún interceptor.

---

## 3. Tipos soportados y código generado

Los dos templates de configuración (`OutboundFeignConfig.java.ejs` para BC→BC y
`ExternalRestConfig.java.ejs` para externos) comparten **lógica de auth idéntica**. Solo
difieren en el default de `timeoutMs` (15 000ms BC→BC vs 30 000ms externos).

### 3.1 `type: api-key`

```yaml
auth:
  type: api-key
  header: X-API-Key                            # opcional, default: X-Api-Key
  valueProperty: integration.sms.api-key       # opcional, default: integration.{target}.api-key
```

**Campos leídos por el template:**
- `auth.header` → nombre del header HTTP. Default: `X-Api-Key`.
- `auth.valueProperty` → clave de property Spring. Default: `integration.{target}.api-key`.

**Código Java generado en `{Target}FeignConfig.java`:**
```java
@Value("${integration.sms.api-key:}")       // ← auth.valueProperty; el ':' da string vacío si ausente
private String apiKey;

@Bean
public RequestInterceptor smsAuthInterceptor() {
    return template -> {
        if (apiKey != null && !apiKey.isBlank()) {
            template.header("X-API-Key", apiKey);    // ← auth.header || 'X-Api-Key'
        }
    };
}
```

**Notas:**
- El sufijo `:` en `@Value("${...}:")` evita `IllegalArgumentException` si la property no está
  definida — inyecta string vacío, no null.
- El guard `!apiKey.isBlank()` evita enviar un header vacío en tiempo de ejecución.
- El generador **no produce ninguna property** `integration.{target}.api-key` en los archivos
  de configuración. Ver [GAP-AUTH-002](#gap-auth-002--placeholders-de-secrets-no-generados).

---

### 3.2 `type: bearer`

```yaml
auth:
  type: bearer
  valueProperty: integration.catalog.bearer-token   # opcional, default: integration.{target}.bearer-token
```

**Campos leídos por el template:**
- `auth.valueProperty` → clave de property Spring. Default: `integration.{target}.bearer-token`.
- `auth.header` → **no leído para este tipo**. El header `Authorization` está hardcodeado en el template.

**Código Java generado en `{Target}FeignConfig.java`:**
```java
@Value("${integration.catalog.bearer-token:}")
private String bearerToken;

@Bean
public RequestInterceptor catalogAuthInterceptor() {
    return template -> {
        if (bearerToken != null && !bearerToken.isBlank()) {
            template.header("Authorization", "Bearer " + bearerToken);
        }
    };
}
```

**Notas:**
- El header siempre es `"Authorization"` con prefijo `"Bearer "` — no configurable.
- `auth.header` se ignora silenciosamente para este tipo (el template solo lo usa para `api-key`).
- El generador **no produce ninguna property** `integration.{target}.bearer-token`.
  Ver [GAP-AUTH-002](#gap-auth-002--placeholders-de-secrets-no-generados).

---

### 3.3 `type: oauth2-cc`

```yaml
auth:
  type: oauth2-cc
  tokenEndpoint: https://auth.provider.example.com/oauth/token   # requerido (INT-015)
  credentialKey: payment-gateway                                  # requerido (INT-015)
```

**Campos leídos por el template:**
- `auth.credentialKey` → id de registro Spring Security OAuth2
  (`spring.security.oauth2.client.registration.{credentialKey}`). Requerido.
- `auth.tokenEndpoint` → validado por INT-015 pero **no inyectado directamente en el template**
  de config. Es la URL del token endpoint que debe configurarse en `application.yaml` manualmente.

**Artefactos generados:**

**1. `{Target}FeignConfig.java`** — inyecta `OAuth2ClientCredentialsSupport`:
```java
private final OAuth2ClientCredentialsSupport oauth2Support;

public PaymentGatewayRestConfig(OAuth2ClientCredentialsSupport oauth2Support) {
    this.oauth2Support = oauth2Support;
}

@Bean
public RequestInterceptor paymentGatewayAuthInterceptor() {
    return oauth2Support.buildInterceptor("payment-gateway");   // ← auth.credentialKey
}
```

**2. `shared/infrastructure/auth/OAuth2ClientCredentialsSupport.java`** — emitido **una sola
vez** cuando alguna integración usa `oauth2-cc` (`hasAnyOAuth2Cc()` = true):
```java
@Configuration
public class OAuth2ClientCredentialsSupport {

    private final OAuth2AuthorizedClientManager authorizedClientManager;

    public OAuth2ClientCredentialsSupport(
            ClientRegistrationRepository clientRegistrationRepository,
            OAuth2AuthorizedClientRepository authorizedClientRepository) {
        // construye DefaultOAuth2AuthorizedClientManager con provider client_credentials
    }

    public RequestInterceptor buildInterceptor(String registrationId) {
        return template -> {
            OAuth2AuthorizeRequest request = OAuth2AuthorizeRequest
                    .withClientRegistrationId(registrationId)
                    .principal("system")
                    .build();
            OAuth2AuthorizedClient client = authorizedClientManager.authorize(request);
            if (client != null && client.getAccessToken() != null) {
                template.header("Authorization", "Bearer " + client.getAccessToken().getTokenValue());
            }
        };
    }
}
```

**3. `build.gradle`** — dependencia condicional:
```groovy
// solo si oauth2ClientEnabled = true (alguna integración usa oauth2-cc)
implementation 'org.springframework.boot:spring-boot-starter-oauth2-client'
```

> `spring-boot-starter-security` y `spring-boot-starter-oauth2-resource-server` se emiten
> **siempre**, independientemente de si hay `oauth2-cc` o no.

**Notas:**
- `tokenEndpoint` es validado por INT-015 pero el generador **no produce** el bloque
  `spring.security.oauth2.client.registration.{credentialKey}` en `application.yaml`.
  Ver [GAP-AUTH-001](#gap-auth-001--configuración-spring-security-oauth2-no-generada).
- El helper `OAuth2ClientCredentialsSupport` usa `principal("system")` hardcodeado —
  no configurable desde el YAML.

---

### 3.4 `type: mTLS`

```yaml
auth:
  type: mTLS
```

**Código Java generado:** ninguno relacionado con auth.

El template evalúa `auth.type === 'api-key'`, `=== 'bearer'`, `=== 'oauth2-cc'` en orden.
`mTLS` no coincide con ninguna rama, por lo que solo se emite el `FeignConfig` con timeouts
y logger level, sin ningún `RequestInterceptor`.

**Efecto colateral:** como `auth` no es null, el template emite `import feign.RequestInterceptor`
al inicio del archivo — import no utilizado en el código generado.

Ver [GAP-AUTH-003](#gap-auth-003--mtls-sin-implementación) y [GAP-AUTH-005](#gap-auth-005--import-muerto-para-tipos-sin-interceptor).

---

### 3.5 `type: internal-jwt`

```yaml
auth:
  type: internal-jwt
```

**Código Java generado:** ninguno relacionado con auth. Mismo comportamiento que `mTLS` —
ninguna rama del template coincide.

La intención declarativa de `internal-jwt` es que la propagación del JWT sea resuelta por
un interceptor Feign global en la infraestructura compartida. El generador **no crea** ese
interceptor global como parte del scaffolding.

Ver [GAP-AUTH-004](#gap-auth-004--no-hay-interceptor-global-para-internal-jwt) y [GAP-AUTH-005](#gap-auth-005--import-muerto-para-tipos-sin-interceptor).

---

### 3.6 `type: none` o ausencia

```yaml
# caso A: auth ausente
integrations:
  - from: orders
    to: catalog
    channel: http
    # (sin bloque auth)

# caso B: auth explícito con type none
auth:
  type: none
```

**Caso A** — `auth` resuelto como `null` por el resolver: el template no genera ningún
interceptor ni import de `RequestInterceptor`. El `FeignConfig` solo contiene logger level
y `Request.Options`.

**Caso B** — `auth: {type: none}` es un objeto no-vacío, por lo que `pickFirst` lo devuelve
como valor resuelto. El template recibe `auth = {type: 'none'}`, evalúa las ramas y no
coincide con ninguna, pero sí emite `import feign.RequestInterceptor` (import muerto).
El comportamiento efectivo es el mismo que caso A. Ver [GAP-AUTH-005](#gap-auth-005--import-muerto-para-tipos-sin-interceptor).

---

## 4. Validaciones activas (INT-015)

La única validación de auth implementada en `integration-validator.js` es **INT-015**, que
cubre exclusivamente `type: oauth2-cc`:

```
INT-015 — level: error
  Aplica a: system.integrations[].auth, system.externalSystems[].auth,
            bc.yaml#/integrations/outbound[].auth
  Condición: auth.type === 'oauth2-cc'
  Errores:
    - Si falta auth.tokenEndpoint → error
    - Si falta auth.credentialKey → error
```

**No existe ninguna validación para:**
- `api-key` — `header` y `valueProperty` opcionales, sin validación de formato
- `bearer` — `valueProperty` opcional, sin validación
- `mTLS` — aceptado silenciosamente, cero código generado
- `internal-jwt` — aceptado silenciosamente, cero código generado
- Tipos no reconocidos — aceptados silenciosamente, cero código generado

---

## 5. Artefactos generados por tipo — resumen

| `auth.type` | `RequestInterceptor` en Config | Helper compartido | `build.gradle` | Validación activa |
|---|---|---|---|---|
| `api-key` | ✅ `@Value` + lambda con header configurable | — | — | — |
| `bearer` | ✅ `@Value` + lambda con `Authorization: Bearer` | — | — | — |
| `oauth2-cc` | ✅ via `OAuth2ClientCredentialsSupport.buildInterceptor()` | `OAuth2ClientCredentialsSupport.java` (1 vez) | `starter-oauth2-client` | INT-015 (tokenEndpoint + credentialKey) |
| `mTLS` | ❌ ninguno | — | — | — |
| `internal-jwt` | ❌ ninguno | — | — | — |
| `none` / ausente | ❌ ninguno | — | — | — |

---

## 6. Gaps identificados

Los gaps a continuación son comportamientos **no implementados** verificados contra el código
fuente. No son bugs — son funcionalidades que el generador no cubre actualmente y que requieren
intervención manual del desarrollador.

---

### GAP-AUTH-001 — Configuración `spring.security.oauth2` no generada

**Afecta a:** `type: oauth2-cc`

**Situación actual:** el generador valida que `tokenEndpoint` y `credentialKey` estén presentes
(INT-015) y genera `OAuth2ClientCredentialsSupport.java` con el `ClientRegistrationRepository`
inyectado. Pero **no genera** el bloque de properties que registra el cliente OAuth2 en Spring:

```yaml
# Este bloque NO es generado — debe añadirse manualmente
spring:
  security:
    oauth2:
      client:
        registration:
          payment-gateway:                           # ← auth.credentialKey
            authorization-grant-type: client_credentials
            client-id: ${PAYMENT_GATEWAY_CLIENT_ID}
            client-secret: ${PAYMENT_GATEWAY_CLIENT_SECRET}
        provider:
          payment-gateway:
            token-uri: https://auth.provider.example.com/oauth/token  # ← auth.tokenEndpoint
```

Sin este bloque, `OAuth2ClientCredentialsSupport` falla en runtime con
`IllegalArgumentException: Could not find ClientRegistration with id 'payment-gateway'`.

**Qué necesitaría para cubrirlo:** nueva sección en `application.yaml.ejs` (o en un archivo
de parámetros separado) que itere sobre las integraciones con `auth.type === 'oauth2-cc'` y
emita el bloque `spring.security.oauth2.client.registration.{credentialKey}` con variables
de entorno derivadas del `credentialKey` (ej: `PAYMENT_GATEWAY_CLIENT_ID`).

---

### GAP-AUTH-002 — Placeholders de secrets no generados

**Afecta a:** `type: api-key`, `type: bearer`

**Situación actual:** el generador emite `@Value("${integration.sms.api-key:}")` en el
`FeignConfig`, pero **no genera** ninguna entrada en los archivos de parámetros
(`urls.yaml`, `application.yaml` o cualquier otro) que documente que esa property debe
ser configurada. El `urls.yaml` generado solo contiene `integration.{target}.base-url`.

```yaml
# urls.yaml generado — solo contiene base-url
integration:
  sms-provider.base-url: https://api.sms-provider.example.com

# Estas entries NO son generadas — el desarrollador debe añadirlas:
  sms-provider.api-key: ${SMS_PROVIDER_API_KEY}      # api-key
  catalog.bearer-token: ${CATALOG_BEARER_TOKEN}      # bearer
```

**Consecuencia:** la aplicación arranca sin error (el `@Value` da string vacío por el `:`)
pero las llamadas salientes se realizan sin autenticación hasta que el desarrollador note
el problema y configure la property.

**Qué necesitaría:** en `urls.yaml.ejs` (o en un nuevo `secrets.yaml.ejs`), emitir una
línea comentada con la clave de property y la variable de entorno sugerida para cada
integración con `api-key` o `bearer`.

---

### GAP-AUTH-003 — `mTLS` sin implementación

**Afecta a:** `type: mTLS`

**Situación actual:** `mTLS` es un valor aceptado por el validador (no emite error) pero
el template no genera ningún código relacionado con TLS mutuo:
- No genera un bean `SSLContext` o `TrustManagerFactory`
- No genera configuración de keystore/truststore en `application.yaml`
- No añade ninguna dependencia al `build.gradle`
- El `FeignConfig` resultante es idéntico al de `type: none`

**Qué necesitaría:** un bloque en el template para `auth.type === 'mTLS'` que genere
configuración de `feign.Client` con `SSLSocketFactory` personalizado, más properties de
keystore/truststore en `application.yaml` con variables de entorno para las rutas y
contraseñas de los certificados.

---

### GAP-AUTH-004 — No hay interceptor global para `internal-jwt`

**Afecta a:** `type: internal-jwt`

**Situación actual:** `internal-jwt` comunica la intención de que el JWT del request
entrante sea propagado al request saliente. El generador no produce ningún código para
esta propagación:
- No existe un `GlobalFeignInterceptor` en el scaffolding de `shared/infrastructure/`
- El `FeignConfig` generado es idéntico al de `type: none`
- Cada desarrollador debe implementar el interceptor global manualmente

**Qué necesitaría:** un artefacto en `shared/infrastructure/auth/` (emitido una sola vez,
igual que `OAuth2ClientCredentialsSupport`) que intercepte el `SecurityContext` del request
entrante, extraiga el JWT raw, y lo propague como header `Authorization: Bearer <token>`
en las llamadas Feign. La habilitación sería condicional a `hasAnyInternalJwt()`.

---

### GAP-AUTH-005 — Import muerto para tipos sin interceptor

**Afecta a:** `type: mTLS`, `type: internal-jwt`, `type: none` (declarado como objeto)

**Situación actual:** el template emite `import feign.RequestInterceptor` cuando `auth` es
truthy (objeto no-null), independientemente de si se genera un `@Bean` que lo use:

```java
// FeignConfig generado para mTLS — import no utilizado:
import feign.RequestInterceptor;   // ← nunca referenciado abajo
import org.springframework.context.annotation.Bean;
// ...
// (no hay @Bean de tipo RequestInterceptor)
```

Esto produce una advertencia del compilador (`unused import`) o del IDE. No causa error de
compilación pero es ruido.

**Qué necesitaría:** ajustar la condición del import a
`if (auth && (auth.type === 'api-key' || auth.type === 'bearer' || auth.type === 'oauth2-cc'))`.

---

### GAP-AUTH-006 — Tipos no reconocidos aceptados silenciosamente

**Afecta a:** cualquier `auth.type` que no sea `api-key`, `bearer`, `oauth2-cc`, `mTLS`,
`internal-jwt` o `none`.

**Situación actual:** el validador no comprueba que `auth.type` sea uno de los valores
reconocidos. Un typo como `type: bearrer` o un valor inventado como `type: custom-token`
no produce ningún error — el generador simplemente no emite interceptor y el developer
no recibe ningún aviso.

**Qué necesitaría:** una regla de validación que compruebe
`auth.type in ['none', 'api-key', 'bearer', 'oauth2-cc', 'mTLS', 'internal-jwt']`
y emita un error cuando se use un valor desconocido.

---

### GAP-AUTH-007 — `infrastructure.integrations.defaults` no implementado

**Afecta a:** cualquier integración HTTP saliente que espere heredar auth de un bloque
de defaults declarado en `system.yaml#/infrastructure/integrations/defaults`.

**Situación actual:** el resolver `resolveAuthForBcHttp` / `resolveAuthForExternal` solo
consulta dos fuentes: el `bc.yaml` outbound y el `system.yaml` integrations/externalSystems.
El campo `system.yaml#/infrastructure/integrations/defaults/auth` **no existe** como nivel
de precedencia en el resolver — es ignorado aunque esté declarado en el YAML.

```
Precedencia REAL (implementada):
  bc.yaml outbound.auth
    ↓
  system.yaml integrations[].auth  /  externalSystems[].auth

Precedencia DOCUMENTADA en skills de diseño (no implementada):
  bc.yaml outbound.auth
    ↓
  system.yaml integrations[].auth
    ↓
  system.yaml infrastructure.integrations.defaults.auth   ← NO procesado
```

**Qué necesitaría:** un tercer nivel de fallback en `pickFirst()` que lea
`system.infrastructure?.integrations?.defaults?.auth`.
