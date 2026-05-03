# Referencia de autenticación saliente — bloque `auth`

> **Alcance:** este documento describe el comportamiento **real y verificado** del generador
> para el bloque `auth` de integraciones HTTP salientes. Documenta qué código se produce,
> qué validaciones se aplican.
>
> Fuentes verificadas:
> - `templates/infrastructure/adapters/OutboundFeignConfig.java.ejs`
> - `templates/infrastructure/adapters/external/ExternalRestConfig.java.ejs`
> - `templates/shared/infrastructure/auth/OAuth2ClientCredentialsSupport.java.ejs`
> - `templates/shared/infrastructure/auth/InternalJwtPropagator.java.ejs`
> - `templates/shared/infrastructure/auth/MutualTlsSupport.java.ejs`
> - `src/utils/resilience-auth-resolver.js`
> - `src/utils/integration-validator.js`
> - `src/generators/base-project-generator.js`
> - `templates/base/gradle/build.gradle.ejs`
> - `templates/base/resources/parameters/{env}/urls.yaml.ejs`
> - `templates/base/resources/parameters/{env}/oauth2.yaml.ejs`
> - `templates/base/resources/parameters/{env}/mtls.yaml.ejs`

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
4. [Validaciones activas (INT-015, INT-024)](#4-validaciones-activas-int-015-int-024)
5. [Artefactos generados por tipo — resumen](#5-artefactos-generados-por-tipo--resumen)
6. [Gaps resueltos](#6-gaps-resueltos)

---

## 1. Dónde puede declararse `auth`

El bloque `auth` puede aparecer en tres ubicaciones:

| Ubicación | Aplica a |
|---|---|
| `system.yaml#/integrations[].auth` | Integración BC→BC (`customer-supplier, channel: http`) |
| `system.yaml#/externalSystems[].auth` | Sistema externo (usado por `pattern: acl, channel: http`) |
| `{bc}.yaml#/integrations/outbound[name=X].auth` | Override por BC de cualquiera de los anteriores |

> `system.yaml#/infrastructure/integrations/defaults.auth` actúa como **tercer nivel de
> fallback** en el resolver — ver sección 2.

---

## 2. Precedencia y resolución

El resolver (`resolveAuthForBcHttp` / `resolveAuthForExternal` en `resilience-auth-resolver.js`)
aplica la siguiente precedencia usando `pickFirst()` — devuelve el primer objeto no-vacío:

```
bc.yaml#/integrations/outbound[name=target].auth           ← override (máxima prioridad)
  ↓ si ausente o vacío
system.yaml#/integrations[from=bc, to=target, channel=http].auth   ← BC→BC
  o
system.yaml#/externalSystems[name=target].auth                     ← externo
  ↓ si ausente o vacío
system.yaml#/infrastructure/integrations/defaults.auth             ← defaults del sistema
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
- El generador emite una entrada **comentada** en `urls.yaml` con la clave de property y la
  variable de entorno sugerida (`${TARGET_API_KEY}`).

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
- El generador emite una entrada **comentada** en `urls.yaml` con la clave de property y la
  variable de entorno sugerida (`${TARGET_BEARER_TOKEN}`).

---

### 3.3 `type: oauth2-cc`

Es el flujo OAuth2 **machine-to-machine** (Client Credentials Grant): el BC se autentica
con un Authorization Server usando un `client_id` + `client_secret` para obtener un access
token, y lo propaga automáticamente en cada llamada saliente. Spring Security gestiona el
ciclo de vida del token — lo solicita al inicio, lo cachea y lo renueva automáticamente
al expirar.

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

**3. `parameters/{env}/oauth2.yaml`** — emitido en los 4 entornos condicionalmente
(`oauth2ClientEnabled = true`), con el bloque `spring.security.oauth2.client`:
```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          payment-gateway:
            authorization-grant-type: client_credentials
            client-id: ${PAYMENT_GATEWAY_CLIENT_ID}  # ← credentialKey en SCREAMING_SNAKE
            client-secret: ${PAYMENT_GATEWAY_CLIENT_SECRET}
        provider:
          payment-gateway:
            token-uri: https://auth.provider.example.com/oauth/token  # ← auth.tokenEndpoint
```

**4. `build.gradle`** — dependencia condicional:
```groovy
// solo si oauth2ClientEnabled = true (alguna integración usa oauth2-cc)
implementation 'org.springframework.boot:spring-boot-starter-oauth2-client'
```

> `spring-boot-starter-security` y `spring-boot-starter-oauth2-resource-server` se emiten
> **siempre**, independientemente de si hay `oauth2-cc` o no.

**Notas:**
- El `oauth2.yaml` se importa desde `application-{env}.yaml` condicionalmente:
  `<%- oauth2ClientEnabled ? '- "classpath:parameters/{env}/oauth2.yaml"' : '' %>`.
- El helper `OAuth2ClientCredentialsSupport` usa `principal("system")` hardcodeado —
  no configurable desde el YAML.

---

### 3.4 `type: mTLS`

```yaml
auth:
  type: mTLS
```

TLS mutuo: el BC presenta un certificado de cliente al servidor y valida el certificado del
servidor usando un truststore propio. Se configura a nivel de `feign.Client.Default`,
not con un `RequestInterceptor`.

**Artefactos generados:**

**1. `{Target}FeignConfig.java`** — inyecta `MutualTlsSupport` y configura `feign.Client.Default`:
```java
import feign.Client;
import com.example.shared.infrastructure.auth.MutualTlsSupport;

private final MutualTlsSupport mutualTlsSupport;

public CatalogFeignConfig(MutualTlsSupport mutualTlsSupport) {
    this.mutualTlsSupport = mutualTlsSupport;
}

@Bean
public Client feignClient() {
    return new Client.Default(mutualTlsSupport.buildSSLSocketFactory(), null);
}
```

**2. `shared/infrastructure/auth/MutualTlsSupport.java`** — emitido **una sola vez**
cuando alguna integración usa `mTLS` (`hasAnyMtls()` = true). Construye un
`SSLSocketFactory` desde keystore/truststore configurados vía properties:
```java
@Configuration
public class MutualTlsSupport {
    @Value("${integration.ssl.keystore-path:}")
    private String keystorePath;
    // ... (keystore-password, truststore-path, truststore-password)

    public SSLSocketFactory buildSSLSocketFactory() {
        // carga PKCS12 keystore + truststore, construye SSLContext TLS
    }
}
```

**3. `parameters/{env}/mtls.yaml`** — emitido en los 4 entornos condicionalmente
(`mtlsEnabled = true`). Entorno `local` incluye defaults con rutas de ejemplo;
los demás entornos usan solo variables de entorno:
```yaml
integration:
  ssl:
    keystore-path: ${SSL_KEYSTORE_PATH}
    keystore-password: ${SSL_KEYSTORE_PASSWORD}
    truststore-path: ${SSL_TRUSTSTORE_PATH}
    truststore-password: ${SSL_TRUSTSTORE_PASSWORD}
```

**Nota:** `import feign.RequestInterceptor` **no se emite** para `mTLS` — mTLS usa
`feign.Client`, no `RequestInterceptor`.

---

### 3.5 `type: internal-jwt`

```yaml
auth:
  type: internal-jwt
```

Propagación del JWT del request entrante hacia todas las llamadas Feign salientes.
Util para comunicación BC→BC donde el token del usuario original debe fluir por toda
la cadena de servicio.

**Artefactos generados:**

**1. `{Target}FeignConfig.java`** — inyecta `InternalJwtPropagator` como `RequestInterceptor` bean:
```java
import feign.RequestInterceptor;
import com.example.shared.infrastructure.auth.InternalJwtPropagator;

private final InternalJwtPropagator internalJwtPropagator;

public CatalogFeignConfig(InternalJwtPropagator internalJwtPropagator) {
    this.internalJwtPropagator = internalJwtPropagator;
}

@Bean
public RequestInterceptor catalogAuthInterceptor() {
    return internalJwtPropagator;
}
```

**2. `shared/infrastructure/auth/InternalJwtPropagator.java`** — emitido **una sola vez**
cuando alguna integración usa `internal-jwt` (`hasAnyInternalJwt()` = true).
`@Component` que implementa `feign.RequestInterceptor` y extrae el token del
`SecurityContextHolder`:
```java
@Component
public class InternalJwtPropagator implements RequestInterceptor {
    @Override
    public void apply(RequestTemplate template) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth instanceof AbstractOAuth2TokenAuthenticationToken<?> tokenAuth) {
            template.header("Authorization", "Bearer " + tokenAuth.getToken().getTokenValue());
        }
    }
}
```

**Nota:** si no hay principal autenticado en el `SecurityContext` (hilos de background,
tests sin contexto), el header no se añade y la llamada procede sin autenticación.

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
como valor resuelto. El template recibe `auth = {type: 'none'}`, evalúa todas las ramas y
no coincide con ninguna. No se emite ningún interceptor ni ningún import de `RequestInterceptor`
(la condición del import excluye explícitamente `none`).

---

## 4. Validaciones activas (INT-015, INT-024)

### INT-015 — `oauth2-cc` requiere `tokenEndpoint` + `credentialKey`

```
INT-015 — level: error
  Aplica a: system.integrations[].auth, system.externalSystems[].auth,
            bc.yaml#/integrations/outbound[].auth
  Condición: auth.type === 'oauth2-cc'
  Errores:
    - Si falta auth.tokenEndpoint → error
    - Si falta auth.credentialKey → error
```

### INT-024 — `auth.type` debe ser un valor reconocido

```
INT-024 — level: error
  Aplica a: system.integrations[].auth, system.externalSystems[].auth,
            bc.yaml#/integrations/outbound[].auth
  Condición: auth está presente y auth.type no es uno de los valores válidos
  Valores válidos: api-key, bearer, oauth2-cc, mTLS, internal-jwt, none
  Error: Unknown auth.type "{value}". Must be one of: ...
```

Ejemplo — typo `type: bearrer` produce:
```
[INT-024] Unknown auth.type "bearrer". Must be one of: api-key, bearer, oauth2-cc, mTLS, internal-jwt, none.
  (system.yaml#/integrations[0]/auth)
```

---

## 5. Artefactos generados por tipo — resumen

| `auth.type` | Artefacto en FeignConfig | Helper compartido | Archivo de config | `build.gradle` | Validación |
|---|---|---|---|---|---|
| `api-key` | `RequestInterceptor` con `@Value` + header configurable | — | comentario en `urls.yaml` | — | — |
| `bearer` | `RequestInterceptor` con `@Value` + `Authorization: Bearer` | — | comentario en `urls.yaml` | — | — |
| `oauth2-cc` | `RequestInterceptor` via `OAuth2ClientCredentialsSupport` | `OAuth2ClientCredentialsSupport.java` (1 vez) | `oauth2.yaml` (4 envs) | `starter-oauth2-client` | INT-015 |
| `mTLS` | `feign.Client.Default` con `SSLSocketFactory` | `MutualTlsSupport.java` (1 vez) | `mtls.yaml` (4 envs) | — | — |
| `internal-jwt` | `RequestInterceptor` via `InternalJwtPropagator` | `InternalJwtPropagator.java` (1 vez) | — | — | — |
| `none` / ausente | ❌ ninguno | — | — | — | INT-024 si typo |

---

## 6. Gaps resueltos

Los siguientes gaps fueron identificados y resueltos. Se documentan como referencia histórica
y para explicar las decisiones de diseño del generador.

---

### GAP-AUTH-001 ✅ — Configuración `spring.security.oauth2` ahora generada

**Resuelto en:** `templates/base/resources/parameters/{env}/oauth2.yaml.ejs` (×4) +
`src/generators/base-project-generator.js` + `templates/base/resources/application-{env}.yaml.ejs` (×4)

El generador ahora produce `parameters/{env}/oauth2.yaml` con el bloque completo
`spring.security.oauth2.client.registration.{credentialKey}` + `.provider.{credentialKey}.token-uri`
para cada integración `oauth2-cc`. El archivo se importa condicionalmente desde
`application-{env}.yaml` cuando `oauth2ClientEnabled = true`.

---

### GAP-AUTH-002 ✅ — Placeholders de secrets ahora generados en `urls.yaml`

**Resuelto en:** `templates/base/resources/parameters/{env}/urls.yaml.ejs` (×4) +
`src/generators/base-project-generator.js`

El generador ahora emite una sección comentada al final de `urls.yaml` con una entrada
por cada integración `api-key` o `bearer`:
```yaml
# ── auth secrets — configure via environment variables ──────────────────
# integration.payment-gateway.api-key: ${PAYMENT_GATEWAY_API_KEY}
```

---

### GAP-AUTH-003 ✅ — `mTLS` implementado con `MutualTlsSupport`

**Resuelto en:** `templates/shared/infrastructure/auth/MutualTlsSupport.java.ejs` (nuevo) +
`templates/infrastructure/adapters/OutboundFeignConfig.java.ejs` +
`templates/infrastructure/adapters/external/ExternalRestConfig.java.ejs` +
`templates/base/resources/parameters/{env}/mtls.yaml.ejs` (×4) +
`src/generators/base-project-generator.js`

`mTLS` ahora genera `MutualTlsSupport.java` (compartido), configura `feign.Client.Default`
con `buildSSLSocketFactory()` en los FeignConfig, y produce `mtls.yaml` en los 4 entornos.

---

### GAP-AUTH-004 ✅ — `internal-jwt` implementado con `InternalJwtPropagator`

**Resuelto en:** `templates/shared/infrastructure/auth/InternalJwtPropagator.java.ejs` (nuevo) +
`templates/infrastructure/adapters/OutboundFeignConfig.java.ejs` +
`templates/infrastructure/adapters/external/ExternalRestConfig.java.ejs` +
`src/generators/base-project-generator.js`

`internal-jwt` ahora genera `InternalJwtPropagator.java` (compartido, emitido 1 vez cuando
`hasAnyInternalJwt()` es true), y los FeignConfig lo inyectan como `RequestInterceptor`.

---

### GAP-AUTH-005 ✅ — Import muerto eliminado para tipos sin `RequestInterceptor`

**Resuelto en:** `templates/infrastructure/adapters/OutboundFeignConfig.java.ejs` +
`templates/infrastructure/adapters/external/ExternalRestConfig.java.ejs`

La condición del `import feign.RequestInterceptor` ahora es explícita:
solo se emite si `auth.type` es `api-key`, `bearer`, `oauth2-cc` o `internal-jwt`.
`mTLS`, `none` y ausencia no producen el import.

---

### GAP-AUTH-006 ✅ — Validación INT-024 para tipos no reconocidos

**Resuelto en:** `src/utils/integration-validator.js`

La regla **INT-024** rechaza cualquier `auth.type` que no esté en el conjunto
`['api-key', 'bearer', 'oauth2-cc', 'mTLS', 'internal-jwt', 'none']`.
Un typo como `type: bearrer` produce error antes de la generación.

---

### GAP-AUTH-007 ✅ — `infrastructure.integrations.defaults.auth` implementado

**Resuelto en:** `src/utils/resilience-auth-resolver.js`

`resolveAuthForBcHttp()` y `resolveAuthForExternal()` ahora consultan un tercer nivel:
`system.infrastructure?.integrations?.defaults?.auth`. La cadena de precedencia completa
es: bc.yaml outbound → system integrations/externalSystems → system defaults.

**Qué necesitaría:** un tercer nivel de fallback en `pickFirst()` que lea
`system.infrastructure?.integrations?.defaults?.auth`.
