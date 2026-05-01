# Referencia completa de `system.yaml`

`system.yaml` es la **fuente de verdad estratégica** del sistema. El generador la lee antes
de procesar cualquier BC para determinar qué infraestructura técnica necesita, qué integraciones
existen entre BCs y con sistemas externos, y para validar la coherencia entre artefactos.

Ubicación requerida: `arch/system/system.yaml`

---

## Tabla de contenidos

1. [Sección `system`](#1-sección-system)
2. [Sección `boundedContexts`](#2-sección-boundedcontexts)
3. [Sección `externalSystems`](#3-sección-externalsystems)
4. [Sección `integrations`](#4-sección-integrations)
5. [Sección `infrastructure`](#5-sección-infrastructure)
6. [Sección `sagas`](#6-sección-sagas)
7. [Sección `actors`](#7-sección-actors)

---

## 1. Sección `system`

Define la identidad del sistema completo.

```yaml
system:
  name: ecommerce-platform
  description: >
    Multi-tenant B2C ecommerce platform for physical product sales.
    Supports catalog management, order lifecycle, and third-party payment processing.
  domainType: core
```

### Propiedades

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | kebab-case string | ✅ | Identificador del sistema. Se usa como `artifactId` en Gradle y como prefijo en configuraciones. |
| `description` | texto libre | no | Propósito del sistema en 2–4 oraciones. Solo referencia humana; no afecta generación. |
| `domainType` | `core` \| `supporting` \| `generic` | no | Clasificación DDD del sistema. Default: `core`. Solo referencia. |

### Qué produce `name`

`system.name: ecommerce-platform` genera:

**`settings.gradle`**
```groovy
rootProject.name = 'ecommerce-platform'
```

**`build.gradle`** (fragmento)
```groovy
group = 'com.mycompany'
version = '0.0.1-SNAPSHOT'
// artifactId = ecommerce-platform
```

**`EcommercePlatformApplication.java`**
```java
@SpringBootApplication
public class EcommercePlatformApplication {
    public static void main(String[] args) {
        SpringApplication.run(EcommercePlatformApplication.class, args);
    }
}
```

---

## 2. Sección `boundedContexts`

Lista los Bounded Contexts del sistema. El generador cruza esta lista con los directorios
descubiertos en `arch/` para emitir advertencias cuando un BC existe en `arch/` pero no
está declarado aquí (o viceversa). **La fuente autoritativa de generación es el filesystem
`arch/`, no esta lista.**

```yaml
boundedContexts:

  - name: catalog
    type: core
    purpose: >
      Manages the lifecycle of products and categories, from draft creation
      to activation and discontinuation.
    aggregates:
      - name: Product
        root: Product
        entities:
          - ProductImage
          - PriceHistory

      - name: Category
        root: Category
        entities: []

  - name: orders
    type: core
    purpose: >
      Manages order placement, confirmation, and fulfillment lifecycle.
    aggregates:
      - name: Order
        root: Order
        entities:
          - OrderLine
```

### Propiedades de un BC

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | kebab-case | ✅ | Debe coincidir con el nombre de carpeta en `arch/{name}/` y con el campo `bc:` del `{name}.yaml`. |
| `type` | `core` \| `supporting` \| `generic` | no | Clasificación DDD del BC. Solo referencia. |
| `purpose` | texto | no | Propósito del BC. Solo referencia humana. |
| `aggregates` | lista | no | Mapa estratégico de agregados. Solo referencia; los detalles tácticos están en el YAML táctico. |

### Propiedades de un agregado (nivel estratégico)

| Propiedad | Tipo | Descripción |
|---|---|---|
| `name` | PascalCase | Nombre del agregado. |
| `root` | PascalCase | Entidad raíz. Casi siempre igual a `name`. |
| `entities` | lista PascalCase | Entidades internas (máx. 4 a nivel estratégico). |

> **Uso en el generador:** estas propiedades son solo referencia estratégica. La generación
> de código se basa en los agregados declarados en `arch/{bc}/{bc}.yaml`, no en este mapa.

---

## 3. Sección `externalSystems`

Declara los sistemas externos con los que el sistema integra. Solo se deben declarar sistemas
que aparezcan referenciados en `integrations[].to` o `integrations[].from`. El generador
usa esta sección para generar los adaptadores ACL de salida y para validar las integraciones.

```yaml
externalSystems:

  - name: payment-gateway
    description: >
      Third-party payment processor that handles card charging and refunds.
    type: payment-gateway
    resilience:
      circuitBreaker:
        failureRateThreshold: 30
        waitDurationInOpenState: 60s
        slidingWindowSize: 10
        minimumNumberOfCalls: 5
        permittedNumberOfCallsInHalfOpenState: 2
      retries:
        maxAttempts: 5
        waitDuration: 1000ms
      connectTimeoutMs: 5000
      timeoutMs: 30000
    auth:
      type: oauth2-cc
      tokenEndpoint: https://auth.payment-gateway.example.com/oauth/token
      credentialKey: payment-gateway
    baseUrlProperty: integration.payment-gateway.base-url  # default: integration.{name}.base-url
    operations:
      - name: chargeCard
        method: POST
        path: /v1/charges
        request:
          fields:
            - name: cardToken
              type: String
            - name: amount
              type: Decimal
        response:
          fields:
            - name: chargeId
              type: String
            - name: status
              type: String
        domain:
          returnType: ChargeResult
          fields:
            - name: id
              type: UUID
              source: chargeId       # campo del responseDto de origen
            - name: status
              type: String
              source: status
      - name: refundCharge
        method: POST
        path: /v1/charges/{chargeId}/refund  # path variable → extraído como @PathVariable

  - name: sms-provider
    description: SMS delivery service for customer notifications.
    type: notification-provider
    auth:
      type: api-key
      header: X-API-Key                           # nombre del header HTTP
      valueProperty: integration.sms-provider.api-key  # clave de la property Spring con el valor
```

### Propiedades

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | kebab-case | ✅ | Debe coincidir con `to` en la integración ACL. Único en `externalSystems`. |
| `description` | texto | no | Qué hace este sistema. Solo referencia. |
| `type` | enum | no | Clasificación del sistema externo. Solo referencia. |
| `resilience` | objeto | no | Configuración de resiliencia para llamadas hacia este sistema. Consultar §4.3. |
| `auth` | objeto | no | Configuración de autenticación saliente. Consultar §4.4. |
| `baseUrlProperty` | string | no | Clave de la property Spring Boot con la URL base. Default: `integration.{name}.base-url`. |
| `operations` | lista | no | Operaciones expuestas por este sistema. Si ausente o vacía, el generador salta la generación del adaptador ACL (INT-008 warn). Ver §3.1. |

### Valores válidos de `type`

`payment-gateway` · `notification-provider` · `identity-provider` · `erp` · `logistics`
· `tax-authority` · `crm` · `analytics` · `storage` · `other`

### 3.1 Sub-sección `operations[]`

Cada entrada describe una operación HTTP expuesta por el sistema externo. El generador produce
un método en `{Ext}ClientPort`, `{Ext}RestClient` y `{Ext}AclAdapter` por cada operación.

#### Propiedades de `operations[]`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | camelCase | ✅ | Nombre del método generado. Validado por INT-008/INT-009. |
| `description` | string | no | Solo referencia. |
| `method` | `GET` \| `POST` \| `PUT` \| `PATCH` \| `DELETE` | no | HTTP verb. Default: `GET`. |
| `path` | string | no | Path HTTP. Soporta path variables `{varName}` — se extraen como `@PathVariable`. Default: `/{name}`. |
| `request` | objeto | no | Body de la petición. Solo efectivo si `method` es `POST`, `PUT` o `PATCH`. |
| `request.fields[]` | lista | no | Campos del body. Generan Java record `{OpName}RequestDto`. |
| `request.fields[].name` | camelCase | ✅ | Nombre del campo. |
| `request.fields[].type` | `String` \| `Integer` \| `Long` \| `Boolean` \| `Decimal` \| `Instant` \| `UUID` | ✅ | Tipo wire-format. `UUID` → `String` en DTO de infra. `Decimal` → `BigDecimal`. |
| `request.fields[].optional` | boolean | no | Si `true`, campo opcional en el DTO. Default: `false`. |
| `response` | objeto | no | Body de la respuesta. |
| `response.fields[]` | lista | no | Campos de la respuesta. Generan `{OpName}ResponseDto`. |
| `response.fields[].name` | camelCase | ✅ | Nombre del campo. |
| `response.fields[].type` | ver tipos arriba | ✅ | Tipo wire-format. |
| `response.fields[].optional` | boolean | no | Si `true`, campo opcional en el DTO. Default: `false`. |
| `domain` | objeto | no | Modelo de dominio al que se traduce la respuesta (ACL). Solo aplica si `response.fields` está declarado. |
| `domain.returnType` | PascalCase | ✅ (si `domain` declarado) | Nombre del Java record generado en `domain/models/{extPackage}/`. |
| `domain.fields[]` | lista | no | Campos del domain record. |
| `domain.fields[].name` | camelCase | ✅ | Nombre del campo. |
| `domain.fields[].type` | ver tipos + nombre de VO/record | ✅ | `UUID` → `java.util.UUID`. Otros valores se usan como nombre de tipo directo. |
| `domain.fields[].source` | camelCase | no | Campo del `{OpName}ResponseDto` de origen. Genera comentario `// source: dto.{source}`. |
| `domain.fields[].derivedFrom` | string | no | Expresión de derivación. Genera comentario `// derived_from: {expr}`. |

#### Tipos wire-format

> **Estos tipos son independientes de los tipos canónicos del `{bc}.yaml`.**
> Los tipos canónicos (`Uuid`, `Money`, `Email`, `String(100)`, `List[T]`, `Range[T]`, etc.)
> aplican a propiedades de entidades, value objects y agregados internos — procesados por
> `type-mapper.js`. Los tipos wire-format aplican **solo** a `operations[].request|response.fields[].type`
> y representan lo que el contrato HTTP externo realmente envía/recibe: primitivos JSON.
> No tiene sentido declarar `Money` o `Email` en un campo de un sistema externo porque
> ese contrato no está bajo tu control. El enriquecimiento hacia tipos de dominio se modela
> en `domain.fields[]`, donde sí se acepta nombre libre de VO o record propio.

| YAML `type` | Java en RequestDto / ResponseDto | Java en domain record |
|---|---|---|
| `String` | `String` | `String` |
| `Integer` | `Integer` | `Integer` |
| `Long` | `Long` | `Long` |
| `Boolean` | `Boolean` | `boolean` |
| `Decimal` | `BigDecimal` | `BigDecimal` |
| `Instant` | `Instant` | `Instant` |
| `UUID` | `String` (wire: llega como string) | `java.util.UUID` |
| nombre libre | `String` (fallback) | nombre libre (VO o record) |

> **`domain` opcional:** si no se declara `domain`, el `{Ext}AclAdapter` llama directamente
> al RestClient y el `AclMapper` se genera con métodos `// TODO` para que el equipo
> complete la traducción ACL.

### Cómo se refleja `externalSystems` en el `{bc}.yaml`

Un sistema externo se referencia en `{bc}.yaml` **exactamente igual** que un BC interno,
dentro de `integrations.outbound[]`. La estructura YAML es idéntica; lo que cambia son
las validaciones que se activan.

Para que el BC `payments` llame al `payment-gateway`:

**`payments.yaml`:**
```yaml
integrations:
  outbound:
    - name: payment-gateway    # ← mismo nombre que externalSystems[].name
      protocol: http
      operations:
        - name: chargeCard     # ← INT-009: debe coincidir con externalSystems[payment-gateway].operations[].name
        - name: refundCharge
      # auth y resilience: omitidos — ya están declarados en system.yaml externalSystems[]
```

**Diferencias respecto a un BC interno:**

| Aspecto | BC interno (`customer-supplier`) | Sistema externo (`acl`) |
|---|---|---|
| Validación de operaciones | INT-003: contra `{target}-internal-api.yaml` | INT-009: contra `externalSystems[name].operations[]` |
| Feign client generado | `{Target}FeignClient` | `{Target}RestClient` |
| `inbound` en el destino | requerido en el `{target}.yaml` | no existe (el externo no tiene `{bc}.yaml`) |
| `auth`/`resilience` | desde `system.yaml integrations[]` | desde `system.yaml externalSystems[]` |

> **INT-004 (bloqueante):** si `system.yaml integrations[from=X, to=Y, pattern=acl]` existe,
> `Y` debe estar declarado en `externalSystems[]`.
>
> **INT-008 (warn):** si `externalSystems[name=Y].operations` está vacío o ausente, el
> generador salta la generación del adaptador para ese contrato.
>
> **`auth` y `resilience` en `outbound`:** si `externalSystems[]` ya los declara, el
> `{bc}.yaml outbound[]` **no debe** repetirlos. Solo declarar en `{bc}.yaml` cuando
> `externalSystems[]` los omite.

### Código Java generado

`externalSystems[name=payment-gateway]` con una integración `pattern: acl, channel: http` genera
(solo cuando `externalSystems[].operations` es no-vacío):

**`PaymentGatewayAclAdapter.java`** — implementa `PaymentGatewayClientPort`
```java
@Component
public class PaymentGatewayAclAdapter implements PaymentGatewayClientPort {

    private final PaymentGatewayRestClient feignClient;
    private final PaymentGatewayAclMapper aclMapper;

    public PaymentGatewayAclAdapter(PaymentGatewayRestClient feignClient, PaymentGatewayAclMapper aclMapper) {
        this.feignClient = feignClient;
        this.aclMapper = aclMapper;
    }

    @Override
    public ChargeResult chargeCard(ChargeCardRequestDto body) {
        return aclMapper.toChargeResult(feignClient.chargeCard(body));
        // La traducción ACL (domain ↔ wire model) vive en PaymentGatewayAclMapper — con // TODO
    }
}
```

**`PaymentGatewayRestClient.java`** (Feign client — nombrado `{Pascal}RestClient` para sistemas externos)
```java
@FeignClient(
    name = "payment-gateway-client",
    url = "${integration.payment-gateway.base-url}",
    configuration = PaymentGatewayRestConfig.class
)
public interface PaymentGatewayRestClient {
    // métodos derivados de los contracts
}
```

---

## 4. Sección `integrations`

Mapa completo de comunicaciones entre partes del sistema. Cada entrada describe **una
dirección** de comunicación. El generador usa esta sección para:

- Generar clientes HTTP Feign (BC→BC, BC→externo)
- Generar publishers y consumers Kafka/RabbitMQ
- Validar coherencia con los `bc.yaml` (reglas INT-001…INT-021)
- Configurar resilience (Resilience4j) y autenticación saliente

```yaml
integrations:

  - from: orders
    to: catalog
    pattern: customer-supplier
    channel: http
    contracts:
      - validateProductsAndPrices
      - getProductById
    notes: >
      orders reads product prices and availability from catalog at placement time.
    resilience:
      circuitBreaker:
        failureRateThreshold: 50
        waitDurationInOpenState: 30s
      retries:
        maxAttempts: 3
        waitDuration: 500ms
      connectTimeoutMs: 5000
      timeoutMs: 3000
    auth:
      type: internal-jwt

  - from: catalog
    to: inventory
    pattern: event
    channel: message-broker
    contracts:
      - name: ProductActivated
        channel: catalog.product.activated
      - name: ProductDiscontinued
        channel: catalog.product.discontinued
    notes: >
      inventory reacts to product lifecycle events to manage StockItems.

  - from: payments
    to: payment-gateway
    pattern: acl
    channel: http
    contracts:
      - chargeCard
      - refundCharge
    notes: >
      ACL isolates the domain from the payment gateway's model.
```

### 4.1 Propiedades de una integración

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `from` | kebab-case | ✅ | BC emisor o sistema externo. |
| `to` | kebab-case | ✅ | BC receptor o sistema externo. |
| `pattern` | enum | ✅ | Patrón de relación. Ver §4.2. |
| `channel` | enum | ✅ | Mecanismo de transporte. Ver §4.2. |
| `contracts` | lista | ✅ | **HTTP:** `operationId` de endpoints declarados en `{to}-internal-api.yaml` o en `externalSystems[].operations`. **No es un caso de uso.** El vínculo con el use case existe en el BC receptor, en su handler. **Eventos:** nombre del domainEvent. Ver §4.2. |
| `notes` | texto | no | Por qué existe esta integración. Solo referencia. |
| `resilience` | objeto | no | Configuración de resiliencia. Ver §4.3. |
| `auth` | objeto | no | Configuración de autenticación. Ver §4.4. |

### 4.2 Combinaciones válidas `pattern` + `channel`

#### `pattern: customer-supplier` + `channel: http`

El BC `from` llama al BC `to` vía REST síncrono. El generador produce:

> **¿Qué es un contract HTTP?** Cada ítem de `contracts` es un **`operationId`** declarado
> en `arch/{to}/{to}-internal-api.yaml`. No es un caso de uso. El generador produce un método
> por cada contract en el Feign client, el puerto y el adaptador. El vínculo con el use case
> vive en el BC receptor (`{to}.yaml`), donde el handler del use case es invocado al recibir
> esa llamada HTTP.

> **Fuente de los campos request/response:** el generador (`outbound-http-generator.js`) **no
> lee campos de ningún YAML propio** para construir los DTOs e interfaces de esta integración.
> Lee directamente los schemas de `components.schemas` del archivo
> `arch/{to}/{to}-internal-api.yaml` (OpenAPI 3.x) y construye a partir de ahí:
> los infra DTOs (`{Schema}Dto.java` — records), los modelos de dominio (`{Schema}.java` — records),
> y las expresiones de mapping en el `{ToBc}AclMapper`. Los tipos se derivan del
> `type`/`format` de OpenAPI (`string` → `String`, `number/double` → `double`, etc.) —
> **no** de los tipos canónicos del `{bc}.yaml`. Si un schema del internal-api coincide con
> el nombre de un Value Object del BC consumidor, el generador reutiliza ese VO en lugar de
> generar un record nuevo.

- En el BC `from`: un **Feign client** (`{ToBc}FeignClient.java`) — interfaz con infra DTOs, nombre Feign `"{to}-service"`
- En el BC `from`: la **interfaz de puerto de salida** (`{ToBc}ServicePort.java`)
- En el BC `from`: el **adaptador de implementación** (`{ToBc}FeignAdapter.java`) — delega al client y mapea via `{ToBc}AclMapper`
- En el BC `from`: la **configuración Feign** (`{ToBc}FeignConfig.java`) — timeouts y auth interceptor
- En el BC `to`: la declaración en `integrations.inbound` del YAML táctico

El validador INT-003 exige:
1. Que exista `arch/{to}/{to}-internal-api.yaml`
2. Que cada contract esté en `{to}.yaml#/integrations/inbound[].operations`
3. Que cada contract esté en `{from}.yaml#/integrations/outbound[name={to}].operations`

**Ejemplo generado** — `CatalogFeignAdapter.java` en BC `orders`:
```java
@Component
public class CatalogFeignAdapter implements CatalogServicePort {

    private final CatalogFeignClient feignClient;
    private final CatalogAclMapper aclMapper;

    public CatalogFeignAdapter(CatalogFeignClient feignClient, CatalogAclMapper aclMapper) {
        this.feignClient = feignClient;
        this.aclMapper = aclMapper;
    }

    @Override
    public ValidateProductsResult validateProductsAndPrices(ValidateProductsRequestDto body) {
        return aclMapper.toValidateProductsResult(feignClient.validateProductsAndPrices(body));
    }
}
```

**Ejemplo generado** — `CatalogFeignClient.java` (retorna infra DTOs, no tipos de dominio):
```java
@FeignClient(
    name = "catalog-service",
    url = "${integration.catalog.base-url}",
    configuration = CatalogFeignConfig.class
)
public interface CatalogFeignClient {

    @PostMapping("/internal/validate-products-and-prices")
    ValidateProductsResultDto validateProductsAndPrices(@RequestBody ValidateProductsRequestDto body);
}
```

---

#### `pattern: event` + `channel: message-broker`

El BC `from` publica eventos que el BC `to` consume. El generador produce:

- En el BC `from`: publishers en la capa de mensajería (`{EventName}Publisher.java`)
- En el BC `to`: consumers (`{EventName}Consumer.java`) con un handler que invoca el use case

El validador INT-001 exige que cada `contract.name` esté en `{from}.yaml#/domainEvents/published`.  
El validador INT-002 exige que esté en `{to}.yaml#/domainEvents/consumed`.

**Formato de contracts para eventos:**
```yaml
contracts:
  # Forma simple (sin channel explícito)
  - ProductActivated

  # Forma extendida (con channel explícito — valida contra convención INT-005)
  - name: ProductActivated
    channel: catalog.product.activated   # convención: {from}.{kebab-event}
```

---

#### `pattern: acl` + `channel: http`

Integración con sistema externo. El validador INT-004 exige que `to` esté declarado en
`externalSystems`. La generación se omite si `externalSystems[name=to].operations` está
vacío o no declarado (INT-008 emite warn y el generador salta ese adaptador).

> **¿Qué es un contract ACL?** Cada ítem de `contracts` es el `name` de una operación
> declarada en `externalSystems[name={to}].operations[]`. No es un caso de uso. Genera un
> método en `{Ext}RestClient`, `{Ext}ClientPort` y `{Ext}AclAdapter`.

**Ejemplo generado** — `SmsProviderAclAdapter.java`:
```java
@Component
public class SmsProviderAclAdapter implements SmsProviderClientPort {

    private final SmsProviderRestClient feignClient;
    private final SmsProviderAclMapper aclMapper;

    public SmsProviderAclAdapter(SmsProviderRestClient feignClient, SmsProviderAclMapper aclMapper) {
        this.feignClient = feignClient;
        this.aclMapper = aclMapper;
    }

    @Override
    public void sendVerificationCode(String phone, String code) {
        feignClient.sendVerificationCode(phone, code); // void → llama directo, sin mapper
    }
}
// El // TODO está en SmsProviderAclMapper (métodos toXxx), no en el adaptador
```

---

### 4.3 Bloque `resilience`

Configura el comportamiento de resiliencia para llamadas HTTP salientes.

| Tipo de integración | Dónde declarar `resilience` en `system.yaml` |
|---|---|
| `pattern: customer-supplier, channel: http` (BC→BC) | `integrations[from=X, to=Y, channel=http].resilience` |
| `pattern: acl, channel: http` (sistema externo) | `externalSystems[name=Y].resilience` |

> **`integrations[pattern=acl].resilience` no es leído por el resolver.** Para sistemas
> externos, la resiliencia vive exclusivamente en `externalSystems[].resilience`
> (o en el override de `{bc}.yaml outbound[].resilience`).

**Precedencia por tipo:**
- BC→BC: `bc.yaml outbound[name=target].resilience` > `system.yaml integrations[from=bc, to=target].resilience`
- Externo: `bc.yaml outbound[name=target].resilience` > `system.yaml externalSystems[name=target].resilience`

#### Estructura real que lee el generador

```yaml
resilience:
  circuitBreaker:                    # presencia (objeto truthy) → @CircuitBreaker en el adaptador
    failureRateThreshold: 50         # → instances.{target}.failureRateThreshold en resilience.yaml
    waitDurationInOpenState: 30s     # → instances.{target}.waitDurationInOpenState (string con unidad)
    slidingWindowSize: 20            # → instances.{target}.slidingWindowSize
    minimumNumberOfCalls: 10         # → instances.{target}.minimumNumberOfCalls
    permittedNumberOfCallsInHalfOpenState: 3  # → instances.{target}...
  retries:                           # CLAVE: "retries" en plural
    maxAttempts: 3                   # > 1 → @Retry en el adaptador; → instances.{target}.maxAttempts
    waitDuration: 500ms              # → instances.{target}.waitDuration (string con unidad)
  connectTimeoutMs: 5000             # timeout de conexión en ms (campo plano)
  timeoutMs: 15000                   # timeout de lectura en ms (campo plano)
```

> Todos los sub-campos de `circuitBreaker` y `retries` son opcionales. Si se omiten todos,
> la anotación se genera igualmente (por la presencia del objeto) pero no se crea bloque
> `instances` en `resilience.yaml` — la instancia hereda `configs.default`.

| Campo | Tipo | Efecto en el generador |
|---|---|---|
| `circuitBreaker` | objeto | Presencia (objeto truthy) → `@CircuitBreaker(name="{target}")` en el adaptador + fallback con `// TODO`. Sub-campos opcionales → bloque `instances.{target}` en `resilience.yaml`. |
| `circuitBreaker.failureRateThreshold` | integer 1-100 | % de fallos para abrir el circuito. Emitido en `instances.{target}` de `resilience.yaml`. |
| `circuitBreaker.waitDurationInOpenState` | string con unidad (`"30s"`, `"60s"`) | Tiempo en estado OPEN antes de pasar a HALF_OPEN. |
| `circuitBreaker.slidingWindowSize` | integer | Tamaño de la ventana deslizante de llamadas. |
| `circuitBreaker.minimumNumberOfCalls` | integer | Mínimo de llamadas antes de calcular el failure rate. |
| `circuitBreaker.permittedNumberOfCallsInHalfOpenState` | integer | Llamadas permitidas en estado HALF_OPEN. |
| `retries.maxAttempts` | integer | > 1 → `@Retry(name="{target}")` en el adaptador. Emitido en `instances.{target}` de `resilience.yaml`. **La clave es `retries` (plural).** |
| `retries.waitDuration` | string con unidad (`"500ms"`, `"1s"`) | Espera entre reintentos. Emitido en `instances.{target}` de `resilience.yaml`. |
| `connectTimeoutMs` | integer (ms) | Connect timeout en `Request.Options` del `FeignConfig`. Default si ausente: 5000ms. |
| `timeoutMs` | integer (ms) | Read timeout en `Request.Options` del `FeignConfig`. Default BC→BC: 15000ms. Default BC→externo: 30000ms. |

### Artefactos generados

#### Artefacto 1 — `{Target}FeignAdapter.java` (anotaciones por método)

```java
// CatalogFeignAdapter.java
// circuitBreaker declarado → @CircuitBreaker en cada método
// retries.maxAttempts: 3 (> 1) → @Retry en cada método
@Component
public class CatalogFeignAdapter implements CatalogServicePort {

    @Override
    @CircuitBreaker(name = "catalog", fallbackMethod = "getProductByIdFallback")
    @Retry(name = "catalog")
    public CatalogProduct getProductById(String productId) {
        return aclMapper.toCatalogProduct(feignClient.getProductById(productId));
    }

    // Generado automáticamente cuando circuitBreaker está declarado:
    @SuppressWarnings("unused")
    private CatalogProduct getProductByIdFallback(String productId, Throwable cause) {
        // TODO: implement fallback — derived_from: resilience.fallback
        throw new UnsupportedOperationException("Fallback not implemented yet", cause);
    }
}
```

Si `circuitBreaker` **no** está declarado → no se genera ninguna anotación y no hay fallback.  
Si `retries.maxAttempts <= 1` o `retries` no está declarado → no se genera `@Retry`.

#### Artefacto 2 — `{Target}FeignConfig.java` (timeouts de Feign)

Los timeouts se aplican en `Request.Options`, no con anotaciones. El generador lee
`resilience.connectTimeoutMs` y `resilience.timeoutMs` como **campos planos**:

```java
// CatalogFeignConfig.java
public class CatalogFeignConfig {

    @Bean
    public Request.Options feignOptions() {
        return new Request.Options(
            5000L, TimeUnit.MILLISECONDS,    // ← resilience.connectTimeoutMs (default: 5000)
            15000L, TimeUnit.MILLISECONDS,   // ← resilience.timeoutMs        (default: 15000)
            true
        );
    }
}
```

Si `connectTimeoutMs` y `timeoutMs` no se declaran, se aplican los defaults del template.

#### Artefacto 3 — `resilience.yaml` (configuración Resilience4j)

Cuando cualquier integración del sistema declara `resilience`, el generador produce
un archivo `resilience.yaml` para cada entorno (`local`, `develop`, `test`, `production`).
Siempre incluye el bloque `configs.default`. Adicionalmente, si alguna integración declara
sub-campos en `circuitBreaker` o `retries`, genera un bloque `instances.{target}` con
`baseConfig: default` y solo los campos declarados explícitamente:

```yaml
# src/main/resources/config/parameters/{env}/resilience.yaml
# derived_from: system.yaml#/integrations[*]/resilience
resilience4j:
  circuitbreaker:
    configs:
      default:                              # aplica a instancias sin bloque propio
        registerHealthIndicator: true
        slidingWindowType: COUNT_BASED
        slidingWindowSize: 20
        minimumNumberOfCalls: 10
        failureRateThreshold: 50
        waitDurationInOpenState: 30s
        permittedNumberOfCallsInHalfOpenState: 3
        automaticTransitionFromOpenToHalfOpenEnabled: true
    instances:                              # generado solo si algún target declara sub-campos
      payment-gateway:                      # ← name del externalSystem o integration.to
        baseConfig: default                 # hereda todo de default, sobreescribe lo declarado
        failureRateThreshold: 30
        waitDurationInOpenState: 60s
  retry:
    configs:
      default:
        maxAttempts: 3
        waitDuration: 500ms
        retryExceptions:
          - feign.RetryableException
          - java.io.IOException
    instances:                              # generado solo si algún target declara sub-campos
      payment-gateway:
        baseConfig: default
        maxAttempts: 5
        waitDuration: 1000ms
```

> Si `circuitBreaker: {}` (sin sub-campos) o `retries: { maxAttempts: 3 }` sin `waitDuration`,
> solo se emiten los campos declarados. La instancia hereda el resto de `configs.default`.
> El bloque `instances` no se genera si ninguna integración declara sub-campos concretos.

#### Flujo real completo

```
system.yaml — resilience:
  circuitBreaker: {}              → @CircuitBreaker(name="{target}") en el adaptador
                                    + método fallback con // TODO
  circuitBreaker.{sub-campos}    → bloque instances.{target} en resilience.yaml
                                    (con baseConfig: default + campos declarados)
  retries.maxAttempts: N (> 1)   → @Retry(name="{target}") en el adaptador
  retries.{sub-campos}           → bloque instances.{target} en resilience.yaml
  connectTimeoutMs: 5000         → Request.Options connect timeout en FeignConfig
  timeoutMs: 15000               → Request.Options read timeout en FeignConfig
```

> **Sin `resilience` declarado:** el adaptador se genera sin ninguna anotación Resilience4j,
> sin fallback, y el archivo `resilience.yaml` no se produce. Las llamadas Feign se ejecutan
> directamente sin protección.

---

### 4.4 Bloque `auth`

Configura la autenticación saliente para integraciones HTTP.

| Tipo de integración | Dónde declarar `auth` en `system.yaml` |
|---|---|
| `pattern: customer-supplier, channel: http` (BC→BC) | `integrations[from=X, to=Y, channel=http].auth` |
| `pattern: acl, channel: http` (sistema externo) | `externalSystems[name=Y].auth` |

> **`integrations[pattern=acl].auth` no es leído por el resolver.** Para sistemas
> externos, la autenticación vive exclusivamente en `externalSystems[].auth`
> (o en el override de `{bc}.yaml outbound[].auth`).

**Precedencia por tipo:**
- BC→BC: `bc.yaml outbound[name=target].auth` > `system.yaml integrations[from=bc, to=target].auth`
- Externo: `bc.yaml outbound[name=target].auth` > `system.yaml externalSystems[name=target].auth`

#### `type: oauth2-cc` — Client Credentials OAuth2

```yaml
auth:
  type: oauth2-cc
  tokenEndpoint: https://auth.payment-gateway.example.com/oauth/token
  credentialKey: payment-gateway
```

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `type` | `oauth2-cc` | ✅ | OAuth2 Client Credentials flow. |
| `tokenEndpoint` | URL | ✅ (INT-015) | Endpoint de token del authorization server. Validado por INT-015 pero no inyectado en `application.yaml` por el generador. |
| `credentialKey` | string | ✅ (INT-015) | Clave de Spring Security OAuth2 registration (`spring.security.oauth2.client.registration.{credentialKey}`). |

> **El generador NO produce el bloque `spring.security.oauth2.client` en `application.yaml`.**
> `tokenEndpoint` y `credentialKey` son validados por INT-015 pero la configuración del
> cliente OAuth2 debe añadirse manualmente. Ver GAP-AUTH-001 en `system-yaml-reference-auth.md`.

**Lo que el generador SÍ produce para `oauth2-cc`:**
1. `{Target}FeignConfig.java` — inyecta `OAuth2ClientCredentialsSupport` y emite `@Bean RequestInterceptor`
2. `shared/infrastructure/auth/OAuth2ClientCredentialsSupport.java` — emitido **una sola vez** si alguna integración usa `oauth2-cc`
3. `build.gradle` — añade `spring-boot-starter-oauth2-client` condicionalmente

#### `type: api-key` — API Key via header

```yaml
auth:
  type: api-key
  header: X-API-Key                           # nombre del header (default: X-Api-Key)
  valueProperty: integration.sms-provider.api-key  # clave de la property Spring con el valor
```

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `type` | `api-key` | ✅ | API Key en header HTTP. |
| `header` | string | no | Nombre del header HTTP. Default: `X-Api-Key`. El template lee `auth.header`. |
| `valueProperty` | string | no | Clave de la property Spring (`@Value("${valueProperty}")`) con el valor del API key. Default: `integration.{target}.api-key`. El template lee `auth.valueProperty`. |

#### `type: bearer` — Bearer token estático

```yaml
auth:
  type: bearer
  valueProperty: integration.catalog.bearer-token  # clave de la property Spring con el token
```

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `type` | `bearer` | ✅ | Bearer token en `Authorization: Bearer <token>`. |
| `valueProperty` | string | no | Clave de la property Spring con el valor del token. Default: `integration.{target}.bearer-token`. |

**Código Java generado** — interceptor en `FeignConfig`:
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

#### `type: internal-jwt` — JWT inter-servicio

```yaml
auth:
  type: internal-jwt
```

> **Atención:** Este tipo es reconocido por el generador (no causa error de validación)
> pero **no genera ningún bean `RequestInterceptor`** en el `FeignConfig`. Los templates
> solo generan interceptores para `api-key`, `bearer` y `oauth2-cc`. Si se declara
> `internal-jwt`, la propagación del JWT debe resolverse mediante un interceptor global
> de Feign en la infraestructura compartida (fuera del scaffolding generado).

---

## 5. Sección `infrastructure`

Declara los requisitos técnicos de despliegue. El generador usa esta sección para incluir
o excluir dependencias en `build.gradle`, generar configuración `application.yaml`, y decidir
si activar el outbox transaccional y la idempotencia de consumidores.

```yaml
infrastructure:
  messageBroker: rabbitmq    # o: kafka
  reliability:
    outbox: true
    consumerIdempotency: true
```

### 5.1 Propiedad `messageBroker`

| Valor | Descripción |
|---|---|
| `rabbitmq` | Genera dependencia `spring-boot-starter-amqp`, configuración AMQP, publishers/consumers RabbitMQ. |
| `kafka` | Genera dependencia `spring-kafka`, configuración Kafka, producers/consumers Kafka. |
| (ausente) | No se genera infraestructura de mensajería. Los use cases con `trigger.kind: event` generan un TODO. |

**Problema que resuelve:** el sistema puede cambiar de broker sin tocar ningún BC YAML.
La decisión de infraestructura vive en `system.yaml` y el generador abstrae las diferencias.

**`build.gradle` generado con `messageBroker: rabbitmq`:**
```groovy
implementation 'org.springframework.boot:spring-boot-starter-amqp'
testImplementation 'org.springframework.amqp:spring-rabbit-test'
```

**`build.gradle` generado con `messageBroker: kafka`:**
```groovy
implementation 'org.springframework.kafka:spring-kafka'
testImplementation 'org.springframework.kafka:spring-kafka-test'
```

**`application.yaml` generado con `messageBroker: rabbitmq`** (fragmento, perfil local):
```yaml
spring:
  rabbitmq:
    host: ${RABBITMQ_HOST:localhost}
    port: ${RABBITMQ_PORT:5672}
    username: ${RABBITMQ_USER:guest}
    password: ${RABBITMQ_PASSWORD:guest}
    virtual-host: ${RABBITMQ_VHOST:/}
```

---

### 5.2 Bloque `reliability`

Activa artefactos de fiabilidad transversal que requieren tablas de base de datos propias.

```yaml
infrastructure:
  reliability:
    outbox: true              # activa el patrón Transactional Outbox
    consumerIdempotency: true # activa el Consumer Idempotency Check
```

#### `outbox: true` — Patrón Transactional Outbox

**Problema que resuelve:** la publicación de eventos no es atómica con la escritura en
base de datos cuando se llama directamente al broker. Si la aplicación falla entre el
`COMMIT` y el `publish`, el evento se pierde. El outbox garantiza que ambas operaciones
ocurren en la misma transacción de base de datos.

**Artefactos generados:**

```
src/main/java/{pkg}/shared/infrastructure/outbox/
├── OutboxEvent.java              ← entidad JPA de la tabla outbox
├── OutboxRepository.java         ← JPA repository
└── OutboxEventPublisher.java     ← @Scheduled que lee y publica eventos pendientes

src/main/resources/db/migration/
└── V001__create_outbox_table.sql
```

**`OutboxEvent.java`** (fragmento):
```java
@Entity
@Table(name = "outbox_event")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class OutboxEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String aggregateType;

    @Column(nullable = false)
    private String aggregateId;

    @Column(nullable = false)
    private String eventType;

    @Column(nullable = false, columnDefinition = "jsonb")
    private String payload;

    @Column(nullable = false)
    private Instant occurredAt;

    @Enumerated(EnumType.STRING)
    private OutboxStatus status; // PENDING, SENT, FAILED
}
```

**`V001__create_outbox_table.sql`:**
```sql
CREATE TABLE IF NOT EXISTS outbox_event (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id   VARCHAR(255) NOT NULL,
    event_type     VARCHAR(200) NOT NULL,
    payload        JSONB        NOT NULL,
    occurred_at    TIMESTAMPTZ  NOT NULL,
    status         VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_status ON outbox_event(status) WHERE status = 'PENDING';
```

---

#### `consumerIdempotency: true` — Consumer Idempotency Check

**Problema que resuelve:** los message brokers pueden entregar el mismo mensaje más de
una vez (at-least-once delivery). Sin idempotencia, el handler del consumer procesaría
el evento múltiples veces, corrompiendo el estado del dominio.

**Artefactos generados:**

```
src/main/java/{pkg}/shared/infrastructure/idempotency/
├── ConsumedEvent.java            ← entidad JPA de la tabla de eventos consumidos
├── ConsumedEventRepository.java  ← JPA repository
└── IdempotencyCheckService.java  ← servicio que verifica si ya fue procesado
```

**`IdempotencyCheckService.java`** (fragmento):
```java
@Service
@Transactional
public class IdempotencyCheckService {

    private final ConsumedEventRepository consumedEventRepository;

    public boolean isAlreadyProcessed(String eventId, String consumerGroup) {
        return consumedEventRepository.existsByEventIdAndConsumerGroup(eventId, consumerGroup);
    }

    public void markAsProcessed(String eventId, String consumerGroup) {
        ConsumedEvent entry = ConsumedEvent.builder()
            .eventId(eventId)
            .consumerGroup(consumerGroup)
            .processedAt(Instant.now())
            .build();
        consumedEventRepository.save(entry);
    }
}
```

---

## 6. Sección `sagas`

Declara procesos de negocio que cruzan 3 o más BCs y requieren coordinación coreografiada
vía eventos. Para procesos de 2 BCs o dentro de un mismo BC, usar `useCases[].aggregates`
en el YAML táctico.

```yaml
sagas:

  - name: OrderFulfillmentSaga
    description: >
      Coordinates the full order fulfillment flow from payment confirmation
      to physical dispatch.
    trigger:
      event: PaymentConfirmed
      bc: payments
    steps:
      - bc: inventory
        action: reserve-stock
        triggeredBy: PaymentConfirmed
        onSuccess: StockReserved
        onFailure: StockReservationFailed
        compensation:
          bc: inventory
          action: release-stock
          triggeredBy: StockReservationFailed

      - bc: orders
        action: confirm-order
        triggeredBy: StockReserved
        onSuccess: OrderConfirmed
        onFailure: OrderConfirmationFailed

      - bc: dispatch
        action: schedule-shipment
        triggeredBy: OrderConfirmed
        onSuccess: ShipmentScheduled
```

### Propiedades de una saga

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | PascalCase | ✅ | Nombre de la saga. Usado como nombre de clase Java. |
| `description` | texto | no | Propósito de la saga. |
| `trigger` | objeto | ✅ | Evento que inicia la saga. |
| `trigger.event` | PascalCase | ✅ | Nombre del evento iniciador. Validado por INT-013. |
| `trigger.bc` | kebab-case | ✅ | BC que publica el evento iniciador. |
| `steps` | lista | ✅ | Pasos del proceso, en orden de ejecución. |

### Propiedades de un step

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `bc` | kebab-case | ✅ | BC que ejecuta este paso. |
| `action` | kebab-case | ✅ | Operación que ejecuta el BC (vinculada a un use case). |
| `triggeredBy` | PascalCase | ✅ | Evento que activa este paso. Validado por INT-012. |
| `onSuccess` | PascalCase | ✅ | Evento publicado cuando el paso tiene éxito. |
| `onFailure` | PascalCase | no | Evento publicado cuando el paso falla. |
| `compensation` | objeto | no | Acción de compensación si este paso falla. |
| `compensation.bc` | kebab-case | ✅ (si compensation) | BC que ejecuta la compensación. |
| `compensation.action` | kebab-case | ✅ (si compensation) | Use case de compensación. |
| `compensation.triggeredBy` | PascalCase | ✅ (si compensation) | Evento que activa la compensación. |

### Código Java generado

El `saga-generator.js` produce **4 artefactos** cuando `system.sagas` es no-vacío:

```
shared/domain/annotations/
└── SagaStep.java                   ← anotación custom para marcar handlers de saga

shared/infrastructure/correlation/
└── CorrelationContext.java         ← propagación de correlationId entre capas

shared/infrastructure/web/
└── CorrelationFilter.java          ← filtro HTTP que abre el contexto de correlación

shared/application/sagas/
└── {SagaName}Steps.java            ← constants holder (uno por saga)
```

**`{SagaName}Steps.java`** es una clase final con constantes — sin lógica, sin listeners,
sin inyección de beans. Sirve para que otros componentes (handlers, tests, tracing) referencien
nombres de eventos y BCs sin hard-codear strings:

```java
// OrderFulfillmentSagaSteps.java
public final class OrderFulfillmentSagaSteps {

    private OrderFulfillmentSagaSteps() {}

    public static final String NAME         = "OrderFulfillmentSaga";
    public static final String TRIGGER_EVENT = "PaymentConfirmed";
    public static final String TRIGGER_BC   = "payments";

    public static final int    STEP_0_ORDER        = 0;
    public static final String STEP_0_BC           = "orders";
    public static final String STEP_0_TRIGGERED_BY = "PaymentConfirmed";
    public static final String STEP_0_SUCCESS       = "OrderConfirmed";
}
```

> **Los listeners con `@RabbitListener`/`@KafkaListener` no son generados por el saga-generator.**
> La lógica de cada paso vive en los event consumers y use case handlers de cada BC,
> generados por `messaging-generator.js` a partir de `domainEvents.consumed[]` en el
> YAML táctico de cada BC.

---

## 7. Sección `actors`

Declara los actores del sistema (personas o sistemas que desencadenan use cases). Cuando
está presente, el generador activa la validación G14: cada `useCases[].actor` en los YAML
tácticos debe referenciar un actor declarado aquí. Cuando está ausente, la validación se
omite (comportamiento legacy).

```yaml
actors:
  - name: customer
    description: Registered customer making purchases.
  - name: admin
    description: Back-office operator managing catalog and inventory.
  - name: system
    description: Internal system-to-system calls (e.g. scheduled jobs, saga triggers).
```

### Propiedades

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | string | ✅ | Identificador del actor. Referenciado en `useCases[].actor`. |
| `description` | texto | no | Rol del actor. Solo referencia. |

### Efecto en el generador

El generador **no produce código Java** a partir de los actores directamente. Su función
es habilitar la validación cruzada en los YAML tácticos:

```yaml
# En catalog.yaml — válido solo cuando system.yaml declara actors[]
useCases:
  - id: UC-PRD-001
    name: ActivateProduct
    type: command
    actor: admin       # ← validado contra system.yaml#/actors[name=admin]
```

Si `actor: marketing` se declara en un use case pero `marketing` no está en `actors[]`,
la build falla con:

```
[bc-yaml-reader] Use case "UC-PRD-001" actor "marketing" is not declared in
system.yaml#/actors. Declare it there or fix the typo.
```

---

## Ejemplo completo de `system.yaml`

```yaml
system:
  name: canasta-shop
  description: >
    Multi-tenant B2C ecommerce platform for physical product sales.
  domainType: core

actors:
  - name: customer
    description: Registered customer making purchases.
  - name: admin
    description: Back-office operator.
  - name: system
    description: Internal automated processes.

boundedContexts:

  - name: catalog
    type: core
    purpose: Manages product and category lifecycle.
    aggregates:
      - name: Product
        root: Product
        entities: [ProductImage, PriceHistory]
      - name: Category
        root: Category
        entities: []

  - name: orders
    type: core
    purpose: Manages order placement and fulfillment.
    aggregates:
      - name: Order
        root: Order
        entities: [OrderLine]

  - name: payments
    type: supporting
    purpose: Handles payment processing via external gateway.
    aggregates:
      - name: Payment
        root: Payment
        entities: []

externalSystems:

  - name: payment-gateway
    description: Third-party card payment processor.
    type: payment-gateway
    resilience:
      circuitBreaker:
        failureRateThreshold: 30
        waitDurationInOpenState: 60s
      retries:
        maxAttempts: 5
        waitDuration: 1000ms
      connectTimeoutMs: 5000
      timeoutMs: 30000
    auth:
      type: oauth2-cc
      tokenEndpoint: https://auth.stripe.example.com/oauth/token
      credentialKey: payment-gateway

integrations:

  - from: orders
    to: catalog
    pattern: customer-supplier
    channel: http
    contracts:
      - validateProductsAndPrices
    notes: orders snapshots prices at placement.
    resilience:
      circuitBreaker:
        failureRateThreshold: 50
        waitDurationInOpenState: 30s
      retries:
        maxAttempts: 3
        waitDuration: 500ms
      connectTimeoutMs: 5000
      timeoutMs: 2000
    auth:
      type: internal-jwt

  - from: catalog
    to: orders
    pattern: event
    channel: message-broker
    contracts:
      - name: ProductDiscontinued
        channel: catalog.product.discontinued
    notes: orders reacts to catalog events to cancel pending order lines.

  - from: payments
    to: payment-gateway
    pattern: acl
    channel: http
    contracts:
      - chargeCard
      - refundCharge
    notes: ACL isolates domain from gateway model.

infrastructure:
  messageBroker: rabbitmq
  reliability:
    outbox: true
    consumerIdempotency: true

sagas:
  - name: OrderFulfillmentSaga
    description: Coordinates payment → stock reservation → dispatch.
    trigger:
      event: PaymentConfirmed
      bc: payments
    steps:
      - bc: orders
        action: confirm-order
        triggeredBy: PaymentConfirmed
        onSuccess: OrderConfirmed
```
