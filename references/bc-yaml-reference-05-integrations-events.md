# Referencia de `{bc}.yaml` — Parte 5: Integrations y domainEvents

---

## Tabla de contenidos

1. [Sección `integrations`](#1-sección-integrations)
   - 1.1 [Outbound HTTP (`integrations.outbound`)](#11-outbound-http-integrationsoutbound)
   - 1.2 [Inbound HTTP (`integrations.inbound`)](#12-inbound-http-integrationsinbound)
2. [Sección `domainEvents`](#2-sección-domainevents)
   - 2.1 [Eventos publicados (`domainEvents.published`)](#21-eventos-publicados-domainevents-published)
   - 2.2 [Payload de eventos](#22-payload-de-eventos)
   - 2.3 [Broker hints (bloque `broker:`)](#23-broker-hints-bloque-broker)
   - 2.4 [Eventos consumidos (`domainEvents.consumed`)](#24-eventos-consumidos-domainevents-consumed)
   - 2.5 [EventMetadata canónico](#25-eventmetadata-canónico)
3. [Sección `eventDtos`](#3-sección-eventdtos)
4. [Ejemplos completos](#4-ejemplos-completos)
5. [Artefactos de infraestructura RabbitMQ generados](#5-artefactos-de-infraestructura-rabbitmq-generados)
   - 5.1 [`parameters/{env}/rabbitmq.yaml`](#51-parametersenvrabbitmsqyaml)
   - 5.2 [`RabbitMQConfig.java` — beans compartidos](#52-rabbitmqconfigjava--beans-compartidos)
   - 5.3 [`{BcPascal}RabbitMQConfig.java` — topología por BC](#53-bcpascalrabbitmqconfigjava--topología-por-bc)
6. [Artefactos de infraestructura Kafka generados](#6-artefactos-de-infraestructura-kafka-generados)
   - 6.1 [`parameters/{env}/kafka.yaml` — conexión y topics](#61-parametersenvkafkayaml--conexión-y-topics)
   - 6.2 [`KafkaConfig.java` — beans compartidos](#62-kafkaconfigjava--beans-compartidos)
   - 6.3 [`{BcPascal}KafkaMessageBroker.java` — adaptador publicador](#63-bcpascalkafkamessagebrokerjava--adaptador-publicador)
   - 6.4 [`{EventName}KafkaListener.java` — adaptador consumidor](#64-eventnamekafkalistenerjava--adaptador-consumidor)
   - 6.5 [Archivos comunes con RabbitMQ](#65-archivos-comunes-con-rabbitmq)

---

## 1. Sección `integrations`

Declara las dependencias HTTP síncronas del BC: servicios externos que este BC **llama**
(`outbound`) y operaciones que otros BCs **llaman a este BC** por HTTP interno (`inbound`).

> **Distinción importante:** `integrations` en el `{bc}.yaml` es la perspectiva del BC
> individual. Las integraciones deben tener su recíproco declarado en `system.yaml`
> bajo `integrations[]` (validación INT-003 / INT-006). Si falta la declaración en
> `system.yaml`, la build falla.

### 1.1 Outbound HTTP (`integrations.outbound`)

Declara una dependencia saliente: este BC **llama** a otro BC o sistema externo vía HTTP.
El generador produce un cliente Feign con adaptadores ACL (Anti-Corruption Layer).

```yaml
integrations:
  outbound:
    - name: catalog          # nombre del BC o sistema externo
      protocol: http         # solo http disponible actualmente
      operations:
        - name: getCatalogProductById
          description: Fetches a product from the catalog service to validate stock creation.
        - name: checkCategoryExists
          description: Verifies that the referenced category is active before creating a product.

      # resiliencia local (override del default en system.yaml)
      resilience:
        circuitBreaker:                       # presencia → @CircuitBreaker en el adaptador
          failureRateThreshold: 50            # % de fallos para abrir el circuito
          waitDurationInOpenState: 30s        # string con unidad (no ISO-8601)
          slidingWindowSize: 10
          minimumNumberOfCalls: 5
          permittedNumberOfCallsInHalfOpenState: 3
        retries:                              # PLURAL — presencia + maxAttempts > 1 → @Retry
          maxAttempts: 3
          waitDuration: 500ms                 # string con unidad (no ISO-8601)
        connectTimeoutMs: 5000               # timeout de conexión en ms — campo plano
        timeoutMs: 15000                     # timeout de lectura en ms — campo plano

      # autenticación local (override del default en system.yaml)
      auth:
        type: oauth2-cc
        tokenEndpoint: https://auth.internal/oauth/token
        credentialKey: catalog-client-secret
```

#### Propiedades de `outbound`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | kebab-case | ✅ | Nombre del BC destino o sistema externo. Debe coincidir con un BC declarado en `system.yaml#/boundedContexts` o con un sistema externo en `system.yaml#/externalSystems`. |
| `protocol` | `http` | ✅ | Solo HTTP disponible en esta versión. |
| `operations` | lista | ✅ | Operaciones que este BC consume del destino. La validación depende del tipo de destino. |
| `operations[].name` | camelCase | ✅ | **BC interno (INT-003):** debe coincidir con un `name` en `{target}.yaml#/integrations.inbound[].operations[]`. El archivo `{target}-internal-api.yaml` debe existir (INT-003 verifica su existencia). **Sistema externo (INT-009):** debe coincidir con un `name` en `system.yaml#/externalSystems[name={target}].operations[]`. |
| `operations[].description` | texto | no | Solo referencia. |
| `resilience` | objeto | no | Configuración de resiliencia local (override del default en `system.yaml`). Ver §1.1.1. |
| `auth` | objeto | no | Configuración de autenticación local (override del default en `system.yaml`). Ver §1.1.2. |

#### 1.1.1 Bloque `resilience` (outbound)

> Este bloque usa el **mismo schema** que `system.yaml#/integrations[].resilience`.
> El resolver lee `bc.yaml` primero y, si está ausente, cae al `system.yaml`. Los campos
> son idénticos en ambos niveles.

```yaml
resilience:
  circuitBreaker:                      # presencia del objeto → @CircuitBreaker en el adaptador
    failureRateThreshold: 50           # % de fallos para abrir el circuito
    waitDurationInOpenState: 30s       # string con unidad: "30s", "60s" (NO ISO-8601)
    slidingWindowSize: 10              # nº de llamadas en la ventana deslizante
    minimumNumberOfCalls: 5            # mínimo antes de calcular failure rate
    permittedNumberOfCallsInHalfOpenState: 3
  retries:                             # PLURAL — presencia + maxAttempts > 1 → @Retry
    maxAttempts: 3
    waitDuration: 500ms                # string con unidad: "500ms", "1s" (NO ISO-8601)
  connectTimeoutMs: 5000               # connect timeout en ms — campo PLANO (no anidado)
  timeoutMs: 15000                     # read timeout en ms — campo PLANO (no anidado)
```

> Todos los sub-campos de `circuitBreaker` y `retries` son **opcionales**. La presencia
> del objeto (aunque vacío) es suficiente para que el generador emita la anotación.
> `connectTimeoutMs` y `timeoutMs` van directamente en `Request.Options` del `FeignConfig`,
> no como anotaciones `@TimeLimiter`. No existe `timeout.duration`, `retry.backoff` ni
> `circuitBreaker.enabled` — esos campos son ignorados.

| Campo | Tipo | Efecto en el generador |
|---|---|---|
| `circuitBreaker` | objeto | Presencia → `@CircuitBreaker(name="{target}")` + método fallback con `// TODO`. Sub-campos → bloque `instances.{target}` en `resilience.yaml`. |
| `circuitBreaker.failureRateThreshold` | integer 1-100 | Emitido en `instances.{target}` de `resilience.yaml`. |
| `circuitBreaker.waitDurationInOpenState` | string con unidad (`"30s"`) | Emitido en `instances.{target}`. |
| `circuitBreaker.slidingWindowSize` | integer | Emitido en `instances.{target}`. |
| `circuitBreaker.minimumNumberOfCalls` | integer | Emitido en `instances.{target}`. |
| `circuitBreaker.permittedNumberOfCallsInHalfOpenState` | integer | Emitido en `instances.{target}`. |
| `retries.maxAttempts` | integer | > 1 → `@Retry(name="{target}")`. Emitido en `instances.{target}`. |
| `retries.waitDuration` | string con unidad (`"500ms"`) | Emitido en `instances.{target}`. |
| `connectTimeoutMs` | integer (ms) | `Request.Options` connect timeout en `FeignConfig`. Default: 5000. |
| `timeoutMs` | integer (ms) | `Request.Options` read timeout en `FeignConfig`. Default BC→BC: 15000. |

**Artefactos generados — `resilience.yaml`** (instancia con sub-campos declarados):
```yaml
# config/parameters/{env}/resilience.yaml
resilience4j:
  circuitbreaker:
    configs:
      default:
        registerHealthIndicator: true
        slidingWindowType: COUNT_BASED
        slidingWindowSize: 20
        minimumNumberOfCalls: 10
        failureRateThreshold: 50
        waitDurationInOpenState: 30s
        permittedNumberOfCallsInHalfOpenState: 3
        automaticTransitionFromOpenToHalfOpenEnabled: true
    instances:
      catalog:                        # ← nombre del target (to:)
        baseConfig: default
        failureRateThreshold: 50      # solo los sub-campos declarados en el YAML
        waitDurationInOpenState: 30s
        slidingWindowSize: 10
  retry:
    configs:
      default:
        maxAttempts: 3
        waitDuration: 500ms
        retryExceptions:
          - feign.RetryableException
          - java.io.IOException
    instances:
      catalog:
        baseConfig: default
        maxAttempts: 3
        waitDuration: 500ms
```

**Artefactos generados — `FeignConfig`** (`connectTimeoutMs` y `timeoutMs`):
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

#### 1.1.2 Bloque `auth` (outbound)

```yaml
auth:
  type: oauth2-cc           # client credentials flow
  tokenEndpoint: https://auth.internal/oauth/token
  credentialKey: catalog-client-secret   # Spring Security registration id (INT-015 lo valida)

  # Para API Key:
  # type: api-key
  # header: X-Api-Key                     # nombre del header (default: X-Api-Key)
  # valueProperty: integration.catalog.api-key  # clave de la property Spring con el valor

  # Para Bearer token estático:
  # type: bearer
  # valueProperty: integration.catalog.bearer-token

  # Para JWT inter-servicio (declarativo — no genera interceptor):
  # type: internal-jwt
```

| `type` | Descripción | Campos adicionales requeridos |
|---|---|---|
| `oauth2-cc` | Client Credentials Flow — obtiene un token Bearer antes de cada llamada (con caché). | `tokenEndpoint`, `credentialKey` |
| `api-key` | Envía una clave estática en un header HTTP. | `header` (default: `X-Api-Key`), `valueProperty` |
| `bearer` | Token Bearer estático en `Authorization: Bearer <token>`. | `valueProperty` |
| `mTLS` | Mutual TLS — autenticación por certificado de cliente. | — |
| `internal-jwt` | Declarativo — no genera interceptor. Requiere interceptor global manual. | — |
| `none` | Sin autenticación (default). | — |

#### Código Java generado (cliente Feign + adaptador ACL)

Para `name: catalog`, `operationId: getCatalogProductById`:

**`CatalogHttpAdapter.java`** (adaptador ACL):
```java
package com.canastaShop.inventory.infrastructure.adapters.catalog;

import feign.FeignException;
import org.springframework.stereotype.Component;

// derived_from: integrations.outbound[name=catalog]
@Component
public class CatalogHttpAdapter implements CatalogPort {

    private final CatalogFeignClient feignClient;

    @Override
    @CircuitBreaker(name = "catalog", fallbackMethod = "getCatalogProductByIdFallback")
    @Retry(name = "catalog")   // solo si retries.maxAttempts > 1
    public Optional<CatalogProductModel> getCatalogProductById(UUID productId) {
        try {
            CatalogProductDto dto = feignClient.getCatalogProductById(productId.toString());
            return Optional.of(CatalogAclMapper.toDomain(dto));
        } catch (FeignException.NotFound e) {
            return Optional.empty();
        }
    }

    private Optional<CatalogProductModel> getCatalogProductByIdFallback(
        UUID productId, Throwable t) {
        // TODO: implement fallback logic — ver inventory-flows.md
        throw new CatalogServiceUnavailableError(t);
    }
}
```

**`CatalogFeignClient.java`:**
```java
@FeignClient(
    name = "catalog",
    url = "${integration.catalog.base-url}",
    configuration = CatalogFeignConfig.class   // incluye OAuth2 interceptor si auth: oauth2-cc
)
public interface CatalogFeignClient {

    @GetMapping("/internal/products/{productId}")
    CatalogProductDto getCatalogProductById(@PathVariable String productId);
}
```

**`CatalogAclMapper.java`** (Anti-Corruption Layer):
```java
public class CatalogAclMapper {

    public static CatalogProductModel toDomain(CatalogProductDto dto) {
        return new CatalogProductModel(
            UUID.fromString(dto.id()),
            dto.name(),
            dto.status()
        );
    }
}
```

---

### 1.2 Inbound HTTP (`integrations.inbound`)

Declara las operaciones internas que **otros BCs** consumen de este BC por HTTP.
El generador verifica que estas operaciones existan en `{bc}-internal-api.yaml`.

```yaml
integrations:
  inbound:
    - operations:
        - name: getCatalogProductById
          description: Called by inventory to validate product existence before stock creation.
        - name: searchCatalogProducts
          description: Called by orders to validate product availability.
```

#### Propiedades de `inbound`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `operations` | lista | ✅ | Operaciones expuestas a otros BCs. Cada `name` debe coincidir con un `operationId` en `{bc}-internal-api.yaml`. |
| `operations[].name` | camelCase | ✅ | `operationId` en el OpenAPI interno. |
| `operations[].description` | texto | no | Solo referencia. |

> **Lo que genera `inbound`:** el generador verifica la coherencia con el
> `{bc}-internal-api.yaml` pero no genera código adicional — el controller y los
> endpoints internos ya se generan a partir del OpenAPI.

---

## 2. Sección `domainEvents`

Declara todos los eventos de dominio que el BC **publica** o **consume**. El generador
produce:

- Para `published[]`: clases Java record (domain event + integration event), publisher
  de mensajes, y enlace desde los handlers al publisher
- Para `consumed[]`: consumer listeners, deserializadores, y mapeo al command/query
  correspondiente (referenciado en `useCases[].trigger.kind: event`)

### 2.1 Eventos publicados (`domainEvents.published`)

```yaml
domainEvents:
  published:
    - name: ProductActivated        # PascalCase — nombre de la clase Java record
      scope: integration            # internal | integration | both
      channel: catalog.product.activated   # canal AsyncAPI
      payload:
        - name: productId
          type: Uuid
          source: aggregate
          field: id

        - name: sku
          type: String(50)
          source: aggregate
          field: sku

        - name: price
          type: Money
          source: aggregate
          field: price

        - name: activatedAt
          type: DateTime
          source: timestamp

        - name: activatedBy
          type: Uuid
          source: param           # ← source: auth-context está prohibido en payload (INT-025)
                                  #   el handler resuelve SecurityContext y lo pasa como param

        - name: promotionCode
          type: String
          source: param           # valor pasado explícitamente al método raise()

        - name: displayCategory
          type: String
          source: derived         # generador emite TODO — lógica derivada

      # broker: hints de publicación — todos opcionales; ver §2.3 para reglas completas
      broker:
        partitionKey: productId      # string — nombre de un campo declarado en payload[]
        headers:                     # mapa string→string; inyectado en cada mensaje
          x-source-bc: catalog
        retry:                       # validado pero actualmente sin efecto en artefactos generados
          maxAttempts: 3
          backoff: exponential       # fixed | exponential
          initialMs: 500
          maxMs: 10000
        dlq:                         # routingKey + queueName se propagan a BcRabbitMQConfig del consumidor
          routingKey: catalog.product.activated.dead
          queueName: catalog-activated-poison   # opcional; default = valor de routingKey
          afterAttempts: 3           # validado pero actualmente sin efecto en artefactos generados
```

#### Propiedades de `published`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | PascalCase | ✅ | Nombre del evento. Genera `{Name}Event.java` (domain event record — con sufijo `Event`) e `{Name}IntegrationEvent.java` (wire format). |
| `scope` | `internal` \| `integration` \| `both` | no | Determina qué capas reciben el evento. `internal`: solo dentro del BC. `integration`: solo hacia el broker. `both`: ambas. **Default: `both`** cuando se omite. |
| `channel` | string | no (recomendado) | Canal del broker. Convención: `{bc}.{kebab-event-name-con-puntos}`. Ej: `catalog.product.activated`. Validación INT-018 compara con AsyncAPI. |
| `payload` | lista | ✅ | Campos del evento. Ver §2.2. |
| `broker` | objeto | no | Hints de publicación para el broker. Claves válidas: `partitionKey`, `headers`, `retry`, `dlq`. Ver §2.3. |
| `allowHiddenLeak` | boolean | no | Si `true`, autoriza que el payload exponga campos marcados `hidden: true` en el agregado (INT-021). Se declara **a nivel del evento**, no en campos individuales. Default: `false`. |

---

### 2.2 Payload de eventos

Cada campo del payload declara de dónde obtiene su valor en runtime.

```yaml
payload:
  - name: productId
    type: Uuid
    source: aggregate           # toma el valor de this.get{Field}()
    field: id                   # nombre del campo en el agregado

  - name: occurredAt
    type: DateTime
    source: timestamp           # Instant.now()

  - name: performedBy
    type: Uuid
    source: param               # ← correcto: el handler resuelve SecurityContext y lo pasa como param
    # source: auth-context      ← INVÁLIDO en payload de evento — INT-025 rechaza la build

  - name: notes
    type: String
    source: param               # parámetro explícito pasado al método raise()

  - name: calculatedRisk
    type: String
    source: constant
    value: "HIGH"               # campo 'value' requerido cuando source: constant

  - name: margin
    type: Decimal
    source: derived             # generador emite TODO null — lógica computada

  # Campo oculto — requiere allowHiddenLeak: true a nivel del EVENTO (no del campo)
  - name: internalCostBasis
    type: Decimal
    source: aggregate
    field: costBasis            # campo marcado hidden: true en el agregado
```

> **`allowHiddenLeak`** se declara a nivel del **evento** (`published[]`), no en el campo individual.
> Ver §2.1 propiedades de `published`.

#### Propiedades de un campo de payload

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | camelCase | ✅ | Nombre del campo en el record Java del evento. |
| `type` | tipo canónico | ✅ | Tipo Java del campo. |
| `source` | enum | ✅ | De dónde proviene el valor en runtime. Ver tabla siguiente. |
| `field` | camelCase | ✅ si `source: aggregate` | Nombre de la propiedad del agregado. Debe existir en `aggregates[].properties`. |
| `value` | literal | ✅ si `source: constant` | Valor constante a emitir. Si se omite, el generador emite `null /* TODO */`. |

#### Valores de `source`

| Valor | Java generado en el método `raise()` | Cuándo usarlo |
|---|---|---|
| `aggregate` | `this.get{Field}()` | El valor proviene directamente del estado del agregado. |
| `timestamp` | `Instant.now()` | Marca temporal del momento en que ocurre el evento. |
| `auth-context` | ❌ **No permitido** — la build falla con INT-025 | No es un origen válido en el payload de un evento. El agregado es agnóstico a la seguridad. Declarar el campo como `source: param`, añadirlo a `domainMethods[].params`, y resolver `SecurityContext` en el handler. |
| `param` | parámetro adicional en la firma de `raise()` | Un valor que se pasa explícitamente al método. Ej: `reason`, `notes`. **El parámetro debe existir en `domainMethods[].params[]` del método que emite el evento** — si no, la build falla con INT-026. Usar `param:` para especificar un nombre de parámetro distinto al nombre del campo. |
| `constant` | valor literal del campo `value` en el payload | Valores fijos. **Requiere declarar `value:` en el campo del payload** (ej: `value: "1"`). Si `value` está ausente, el generador emite un TODO con null. |
| `derived` | `null /* TODO: source=derived — implement in aggregate */` | El valor se **calcula dentro del propio agregado** a partir de su estado interno, pero la fórmula es lógica de negocio que el generador no puede inferir del YAML. El generador reserva el hueco con `null` y un TODO. La implementación queda para Fase 3 **dentro del método del agregado**. ⚠️ Si el cálculo requiere consultar una fuente externa (otra entidad, proyección, servicio), usar `source: param` en su lugar — el handler hace la consulta y pasa el resultado como argumento. |

#### `source: derived` vs `source: param` — frontera crítica

| Pregunta | `source: derived` | `source: param` |
|---|---|---|
| ¿El agregado puede calcular el valor **solo**, con los campos que ya tiene? | ✅ Sí | ❌ No |
| ¿Requiere consultar otra entidad, proyección o servicio externo? | ❌ No | ✅ Sí — el handler lo resuelve y lo pasa |
| ¿Quién implementa la lógica en Fase 3? | El desarrollador, **dentro del método del agregado** | El desarrollador, **en el handler** (busca el valor y lo pasa como argumento) |

**`source: derived` correcto** — cálculo a partir del estado propio del agregado:

```yaml
- name: discountedPrice
  type: Money
  source: derived   # = this.price × (1 - this.discountRate)
                    # ambos campos viven en el agregado
                    # la fórmula es lógica interna, el generador emite null + TODO
```

```java
// Fase 3 — lógica implementada dentro del propio agregado
public void applyPromotion(String promotionCode) {
    // ...
    raise(new PromotionAppliedEvent(
        ...
        this.getPrice().multiply(BigDecimal.ONE.subtract(this.getDiscountRate())) // ← ya no es null
    ));
}
```

**`source: param` correcto** — el valor requiere una consulta externa:

```yaml
- name: categoryName
  type: String
  source: param     # el handler busca el nombre en la proyección y lo pasa como argumento
                    # el agregado solo guarda categoryId (UUID), no el nombre legible
```

```java
// Fase 3 — el handler resuelve la consulta y pasa el valor al agregado
String categoryName = categoryReadRepository.findNameById(product.getCategoryId());
product.activate(activatedBy, promotionCode, categoryName);

// En Product.java — recibe el valor como param, sin saber de dónde vino
public void activate(UUID activatedBy, String promotionCode, String categoryName) {
    raise(new ProductActivatedEvent(
        ...,
        categoryName   // ← source: param, no derived
    ));
}
```

> ❌ **Error común**: declarar `source: derived` para un campo que en realidad proviene de otra
> entidad o proyección, e implementar la consulta en el handler antes de llamar al método del
> agregado. Eso es `source: param` — el handler hace la resolución, no el agregado.

---

#### Código Java generado

**`ProductActivatedEvent.java`** (domain event record — el generador añade el sufijo `Event`):
```java
package com.canastaShop.catalog.domain.events;

import java.time.Instant;
import java.util.UUID;

// derived_from: domainEvents.published.ProductActivated
public record ProductActivatedEvent(
    EventMetadata metadata,   // ← solo si events.metadata.enabled = true
    UUID productId,
    String sku,
    Money price,
    Instant activatedAt,
    UUID activatedBy,
    String promotionCode,
    String displayCategory
) implements DomainEvent {}
```

**Cómo el generador emite el evento en el agregado** (generado cuando `domainMethods[].emits: ProductActivated`):

El evento **no se devuelve** — se acumula con `raise()` dentro del método de negocio existente (`void`).
El generador produce el statement `raise(new XxxEvent(...))` e incrusta los argumentos resolviendo
cada campo de `payload[].source` (ver tabla de resolución más abajo).

```java
// En Product.java — el método de negocio es void, no devuelve el evento
// activatedBy viene como param porque source: auth-context está prohibido en event payload (INT-025);
// el handler de aplicación lo extrae de SecurityContext y lo pasa como argumento ordinario.
public void activate(UUID activatedBy, String promotionCode) {
    // (transición de estado, si aplica)
    this.status = this.status.transitionTo(ProductStatus.ACTIVE);
    // derived_from: domainEvents.published.ProductActivated
    raise(new ProductActivatedEvent(
        EventMetadata.now("ProductActivated", 1, "catalog"),   // metadata (si events.metadata.enabled = true)
        this.getId(),                      // source: aggregate, field: id
        this.getSku(),                     // source: aggregate, field: sku
        this.getPrice(),                   // source: aggregate, field: price
        Instant.now(),                     // source: timestamp
        activatedBy,                       // source: param (resuelto en el handler desde SecurityContext)
        promotionCode,                     // source: param
        null /* TODO domainEvent(ProductActivated, displayCategory): source=derived — implement projection */
    ));
}
```

**Flujo completo de publicación** (tres capas):

```
1. Aggregate.activate(promotionCode)
       → raise() acumula el evento en la lista interna _domainEvents

2. repository.save(product)
       → persiste en base de datos

3. product.pullDomainEvents().forEach(eventPublisher::publishEvent)
       → vacía _domainEvents y los despacha vía Spring ApplicationEventPublisher
         (generado en RepositoryImpl, solo cuando el agregado emite eventos)
```

**Tabla de resolución de argumentos** (`payload[].source`):

| `source` | Argumento generado | Notas |
|---|---|---|
| `aggregate` | `this.getId()` / `this.getXxx()` | `field` debe existir en el agregado |
| `param` | nombre del parámetro del método | `param` debe estar en la firma |
| `timestamp` | `Instant.now()` | — |
| `constant` | literal Java del `value` declarado | string → quoted, number/bool → literal |
| `auth-context` | ❌ **Prohibido** — INT-025 detiene la build | Usar `source: param` en el payload + resolver `SecurityContext` en el handler |
| `derived` | `null /* TODO ... */` | requiere implementación manual en Fase 3 |

---

#### Cómo pasar datos de autenticación a un evento (reemplaza `source: auth-context`)

`source: auth-context` está **prohibido** en `domainEvents.published[].payload[]` (INT-025).
El patrón correcto es declarar el campo como `source: param` en el payload y resolverlo en el handler.
Hay **dos caminos** dependiendo del tipo de use case:

---

##### Camino A — use case `create` sin `domainMethods.params` (resolución automática)

Este es el **único caso** en que el generador resuelve `authContext` automáticamente.
Condición exacta en el código: `isCreate === true && dmParams.length === 0`
([application-generator.js línea ~1014](../src/generators/application-generator.js)).

Declarar el campo en `uc.input[]` con `source: authContext`:

```yaml
useCases:
  - id: create-order
    name: CreateOrder
    type: command
    aggregate: Order
    method: create
    implementation: full
    input:
      - name: customerId
        type: Uuid
      - name: createdBy         # ← campo de auth
        type: Uuid
        source: authContext     # ← excluido del command record; extraído de SecurityContext en el handler

aggregates:
  - name: Order
    domainMethods:
      - name: create
        # SIN params declarados → el generador usa uc.input[] para construir los args
        emits: OrderPlaced
```

El generador produce en el handler (`implementation: full`):

```java
// En CreateOrderCommandHandler.java — generado automáticamente
@Override
@Transactional
public void handle(CreateOrderCommand command) {
    // command.createdBy() NO EXISTE — fue excluido del record
    // el generador inyecta la extracción de SecurityContext directamente en el callArg:
    Order order = Order.create(
        UUID.fromString(command.customerId()),
        UUID.fromString(SecurityContextHolder.getContext().getAuthentication().getName())
        //              ↑ source: authContext resuelto automáticamente
    );
    orderRepository.save(order);
}
```

> **Restricción real del generador**: este path solo funciona cuando el `domainMethod.create`
> no tiene `params` declarados. En cuanto `dmParams.length > 0`, el generador usa los
> `dmParams` como fuente de verdad y `uc.input[].source` es ignorado para el cuerpo.

---

##### Camino B — métodos no-create (p.ej. `activate`) — Fase 3 manual

Para métodos como `activate`, `discontinue`, `update`, etc., el generador **no auto-resuelve**
`authContext`. El tratamiento real es:

- **`implementation: scaffold`**: el handler emite un comentario TODO si el agregado tiene
  una propiedad con `source: authContext` (leído de `aggregates[].properties[]`, no de `uc.input[]`).
  El cuerpo lanza `UnsupportedOperationException`.
- **`implementation: full`**: el handler mapea los `domainMethods.params` a `command.xxx()`.
  Si `activatedBy` es un `dmParam`, genera `UUID.fromString(command.activatedBy())` —
  esperando que venga en el body de la request.

La solución correcta en Fase 3 es que el desarrollador añada `activatedBy` como `dmParam` y
resuelva la extracción del `SecurityContext` manualmente en el handler usando la clase utilitaria
generada `SecurityContextUtil`:

```java
// En ActivateProductCommandHandler.java — Fase 3, implementación manual
@Override
@Transactional
public void handle(ActivateProductCommand command) {
    Product product = productRepository.findById(UUID.fromString(command.productId()))
        .orElseThrow(ProductNotFoundError::new);

    // source: auth-context → el desarrollador extrae el claim manualmente
    // SecurityContextUtil es generado en shared/infrastructure/security/
    String sub = SecurityContextUtil.currentUserClaim("sub");
    UUID activatedBy = sub != null ? UUID.fromString(sub) : null;

    product.activate(command.promotionCode(), activatedBy);
    productRepository.save(product);
}
```

Y el agregado recibe `activatedBy` como param ordinario, sin saber de dónde viene:

```java
// En Product.java — el agregado nunca toca SecurityContext
public void activate(String promotionCode, UUID activatedBy) {
    this.status = this.status.transitionTo(ProductStatus.ACTIVE);
    // derived_from: domainEvents.published.ProductActivated
    raise(new ProductActivatedEvent(
        EventMetadata.now("ProductActivated", 1, "catalog"),
        this.getId(),           // source: aggregate, field: id
        this.getSku(),          // source: aggregate, field: sku
        this.getPrice(),        // source: aggregate, field: price
        Instant.now(),          // source: timestamp
        activatedBy,            // source: param ← ya no es null (resuelto en el handler)
        promotionCode,          // source: param
        null /* TODO displayCategory: source=derived */
    ));
}
```

> **Regla de oro**: `source: auth-context` **no existe** en el payload de un evento — la build
> falla con INT-025 antes de generar código. El patrón correcto es `source: param` en el payload
> + el handler resuelve `SecurityContext` y lo pasa al método del dominio como argumento ordinario.
> El agregado siempre recibe tipos de dominio puros (UUID, String, etc.).
> `SecurityContextUtil` (generado en `shared/infrastructure/security/`) provee los helpers
> `currentUserClaim(String claim)` y `hasAnyRole(String... roles)`.

---

### 2.3 Broker hints (bloque `broker:`)

El bloque `broker:` es un objeto opcional en `published[]` que permite declarar hints de publicación agnósticos al broker. El generador lo valida estrictamente: cualquier clave no reconocida provoca un `GEN-ERROR` inmediato.

```yaml
domainEvents:
  published:
    - name: ProductActivated
      scope: integration
      channel: catalog.product.activated
      payload:
        - name: productId
          type: Uuid
          source: aggregate
          field: id
        - name: sku
          type: String(50)
          source: aggregate
          field: sku
      broker:
        partitionKey: productId           # string — nombre del campo en payload[]
        headers:
          x-source-bc: catalog
          x-event-version: "1"
        retry:
          maxAttempts: 3
          backoff: exponential
          initialMs: 500
          maxMs: 10000
        dlq:
          afterAttempts: 3
          routingKey: catalog.product.activated.dead
          queueName: catalog-product-activated-poison   # opcional; default: valor de routingKey
```

#### Sub-campos del bloque `broker:`

| Clave | Tipo | Descripción | Efecto en generación |
|---|---|---|---|
| `partitionKey` | string | Nombre de un campo declarado en `payload[]`. Kafka usa ese campo como clave de partición para garantizar orden por entidad. | Genera `String.valueOf(event.{field}())` como clave en `KafkaMessageBroker.java`. Ignorado en RabbitMQ. |
| `headers` | mapa string→string | Cabeceras estáticas (o plantillas de string) que se inyectan en cada mensaje publicado. | Genera `record.headers().add(...)` en `KafkaMessageBroker.java` y `message.getMessageProperties().setHeader(...)` en `RabbitMessageBroker.java`. |
| `retry` | objeto | Configuración de reintentos de publicación. Ver tabla de sub-claves. | **Actualmente validado y almacenado, pero no propagado a ningún artefacto generado.** Reservado para implementación futura. |
| `dlq` | objeto | Identificación de la Dead Letter Queue. Ver tabla de sub-claves. | `dlq.routingKey` y `dlq.queueName` se propagan a las declaraciones de cola del lado consumidor en `{Bc}RabbitMQConfig.java`. |

##### Sub-claves de `broker.retry`

| Clave | Tipo | Descripción |
|---|---|---|
| `maxAttempts` | entero ≥ 1 | Número máximo de intentos (incluye el primero). |
| `backoff` | `fixed` \| `exponential` | Estrategia de retardo entre reintentos. |
| `initialMs` | entero ≥ 0 | Retardo inicial en milisegundos. |
| `maxMs` | entero ≥ 0 | Retardo máximo en milisegundos (para backoff exponencial). |

##### Sub-claves de `broker.dlq`

| Clave | Tipo | Requerido | Descripción |
|---|---|---|---|
| `routingKey` | string | no | Routing key que el DLX usará para enrutar mensajes rechazados. Si se omite, el generador deriva el nombre por convención (`{queueKey}`). |
| `queueName` | string | no | Nombre físico de la DLQ. Si se omite, se usa el valor de `routingKey`. |
| `afterAttempts` | entero ≥ 1 | no | Número de intentos tras los cuales el mensaje se envía a la DLQ. Validado pero actualmente no propagado a artefactos generados. |

#### Reglas de validación

| Regla | Detalle |
|---|---|
| Clave desconocida en `broker:` | `GEN-ERROR` — `broker` solo acepta: `partitionKey`, `headers`, `retry`, `dlq`. |
| `broker.partitionKey` | Debe ser un string que coincida con un `name` declarado en `payload[]`. Si es de otro tipo → `GEN-ERROR`. Si no existe en payload → `GEN-ERROR`. |
| `broker.headers` | Debe ser un mapa (no lista). Valores convertidos a string automáticamente. |
| `broker.retry` | Solo acepta: `maxAttempts`, `backoff`, `initialMs`, `maxMs`. Cualquier otra clave → `GEN-ERROR`. |
| `broker.dlq` | Solo acepta: `afterAttempts`, `routingKey`, `queueName`. Cualquier otra clave → `GEN-ERROR`. |

---

### 2.3b Tipos complejos en el payload — Value Objects y snapshots

El payload de un evento no está limitado a tipos escalares. El generador soporta
**Value Objects declarados en `valueObjects[]` del mismo BC** y **listas de VOs** como
campos del payload.

#### Comportamiento verificado del generador

| Tipo en YAML | Java generado | Import generado |
|---|---|---|
| `Uuid`, `String`, `Integer`, etc. | tipo Java escalar | según `type-mapper.js` |
| `Money` | `Money` | `{pkg}.{bc}.domain.valueobject.Money` |
| `OrderLineSnapshot` (VO del BC) | `OrderLineSnapshot` | `{pkg}.{bc}.domain.valueobject.OrderLineSnapshot` |
| `List[OrderLineSnapshot]` | `List<OrderLineSnapshot>` | `java.util.List` + import del VO |
| `List[String]` | `List<String>` | `java.util.List` |

Fuente: `javaTypeForEventField()` en [messaging-generator.js](../src/generators/messaging-generator.js).
El set `voNames` se construye de `bcYaml.valueObjects` del mismo BC productor (línea 738).
Tipos desconocidos que no son enum ni VO declarado producen error en `value-object-generator.js`.

#### Patrón: Event-Carried State Transfer con snapshots

Un **snapshot** es un VO inmutable que captura el estado de una entidad **en el momento
exacto del evento**. Permite que los BC consumidores sean autónomos: reciben todos los
datos necesarios sin tener que consultar al BC productor.

```yaml
# En orders.yaml — BC productor
# REQUISITO: el agregado debe almacenar la propiedad con el mismo tipo VO.
# source: aggregate emite this.getLines() sin transformación — los tipos deben coincidir.

valueObjects:
  - name: OrderLineSnapshot
    immutable: true
    properties:
      - name: productId
        type: Uuid
      - name: sku
        type: String(50)
      - name: quantity
        type: Integer
      - name: unitPrice
        type: Money

aggregates:
  - name: Order
    properties:
      - name: lines
        type: List[OrderLineSnapshot]   # ← el agregado guarda el VO directamente,
                                        #   NO List[OrderLine] (entidad mutable)
    domainMethods:
      - name: place
        emits: OrderPlaced

domainEvents:
  published:
    - name: OrderPlaced
      scope: integration
      channel: orders.order.placed
      payload:
        - name: orderId
          type: Uuid
          source: aggregate
          field: id
        - name: lines
          type: List[OrderLineSnapshot]   # ← coincide con el tipo de la propiedad del agregado
          source: aggregate
          field: lines                    # generador emite: this.getLines() → List<OrderLineSnapshot> ✅
        - name: placedAt
          type: DateTime
          source: timestamp
```

> ⚠️ Si el agregado guarda `lines: List[OrderLine]` (entidad con comportamiento) en lugar de
> `List[OrderLineSnapshot]`, los tipos no coinciden y el código no compila. En ese caso usar
> `source: param` — ver sección "Patrón de conversión entidad → snapshot" más abajo.

**Java generado:**

```java
// OrderPlacedEvent.java
public record OrderPlacedEvent(
    EventMetadata metadata,
    UUID orderId,
    List<OrderLineSnapshot> lines,   // ← import: java.util.List + OrderLineSnapshot
    Instant placedAt
) implements DomainEvent {}
```

```java
// En Order.java — this.getLines() devuelve List<OrderLineSnapshot> porque el agregado
// almacena ese tipo directamente. El generador no hace ninguna transformación.
public void place() {
    // derived_from: domainEvents.published.OrderPlaced
    raise(new OrderPlacedEvent(
        EventMetadata.now("OrderPlaced", 1, "orders"),
        this.getId(),         // source: aggregate, field: id
        this.getLines(),      // source: aggregate, field: lines — List<OrderLineSnapshot> ✅
        Instant.now()         // source: timestamp
    ));
}
```

#### Restricciones verificadas

| Restricción | Detalle |
|---|---|
| **El VO debe estar en el mismo BC** | `voNames` se construye de `bcYaml.valueObjects[]` del BC productor. Un tipo de otro BC no es resolvible — el generador lo trata como tipo de dominio desconocido y falla. |
| **`source: aggregate` solo cuando los tipos coinciden** | Usar `source: aggregate` únicamente si el agregado ya almacena el VO snapshot directamente (`lines: List[OrderLineSnapshot]`). El generador emite `this.getLines()` sin transformación. Si el tipo del agregado es diferente (`List[OrderLine]`), usar `source: param`. |
| **`source: param` para conversiones entidad → snapshot** | Si el agregado guarda entidades mutables y el evento necesita snapshots, declarar el campo como `source: param` en el evento y como parámetro en `domainMethods[].params[]`. El handler construye los snapshots y los pasa al método del dominio. El agregado los recibe como parámetros ordinarios sin saber cómo se construyeron. Ver patrón completo más abajo. |
| **`typeHint` explícito en params gana sobre inferencia** | Si `domainMethods[].params[]` declara `type: List[OrderLineSnapshot]`, ese tipo se usa para la firma del método aunque el agregado tenga una propiedad con el mismo nombre y distinto tipo. El generador resuelve el `typeHint` del YAML primero. |
| **INT-020 no valida estructura del VO** | La validación cruzada solo compara nombres de campos del payload — no entra dentro de la estructura del VO. El BC consumidor puede declarar el mismo tipo en su propio `valueObjects[]` para deserializar con estructura, o tratarlo como `Map<String, Object>` en el listener. |

#### Patrón de conversión entidad → snapshot (Fase 3)

Cuando el agregado guarda `List[OrderLine]` (entidades con comportamiento) pero el evento
necesita `List[OrderLineSnapshot]` (VOs inmutables para el wire), el agregado **no debe
hacer esa conversión** — es responsabilidad de presentación. El patrón correcto:

```yaml
aggregates:
  - name: Order
    properties:
      - name: lines
        type: List[OrderLine]         # ← entidad mutable con comportamiento de dominio
    domainMethods:
      - name: place
        params:
          - name: lines
            type: List[OrderLineSnapshot]   # ← typeHint explícito; gana sobre la prop del agregado
        emits: OrderPlaced

domainEvents:
  published:
    - name: OrderPlaced
      payload:
        - name: lines
          type: List[OrderLineSnapshot]
          source: param               # ← el handler construye los snapshots y los pasa
```

**Java generado — el agregado recibe el snapshot como parámetro, no lo construye:**

```java
// Order.java — firma correcta gracias al typeHint en domainMethods.params
public void place(List<OrderLineSnapshot> lines) {
    // derived_from: domainEvents.published.OrderPlaced
    raise(new OrderPlacedEvent(
        EventMetadata.now("OrderPlaced", 1, "orders"),
        this.getId(),
        lines          // source: param — viene del handler
    ));
}
```

```java
// PlaceOrderCommandHandler.java — generado con implementation: scaffold
// El código compila desde el inicio; Fase 3 reemplaza el cuerpo
@Override
@Transactional
public void execute(PlaceOrderCommand command) {
    // TODO: implement business logic — ver orders-flows.md
    throw new UnsupportedOperationException("Not implemented yet");
}
```

**Fase 3 — el handler implementa la conversión y el código ya compilaba:**

```java
// PlaceOrderCommandHandler.java — implementado en Fase 3
@Override
@Transactional
public void execute(PlaceOrderCommand command) {
    Order order = orderRepository.findById(UUID.fromString(command.orderId()))
        .orElseThrow(OrderNotFoundError::new);

    // El handler convierte entidades → snapshots; el agregado no sabe nada de esto
    List<OrderLineSnapshot> snapshots = order.getLines().stream()
        .map(line -> new OrderLineSnapshot(
            line.getProductId(),
            line.getSku(),
            line.getQuantity(),
            line.getUnitPrice()
        ))
        .toList();

    order.place(snapshots);
    orderRepository.save(order);
}
```

> **Regla:** el agregado nunca construye snapshots de sus propias entidades hijas.
> Eso es lógica de presentación/serialización que pertenece al handler.
> El agregado solo recibe el snapshot como parámetro y lo pasa al `raise()`.

#### Cuándo usar snapshot vs referencia

| Patrón | Cuándo usarlo |
|---|---|
| **Snapshot** (`List[OrderLineSnapshot]`) | El consumidor necesita los datos ahora, sin consultar al productor. Los datos son relevantes en el momento del evento (precio de compra, no precio actual). |
| **Referencia** (`orderId: Uuid`) | El consumidor puede y debe consultar el estado actual. Los datos cambian y la lectura tardía es correcta. |
| **Datos escalares planos** | El evento es una notificación delgada; el consumidor decide si necesita más datos. |

---

### 2.4 Eventos consumidos (`domainEvents.consumed`)

Declara los eventos que este BC recibe del broker y cómo procesa su payload.

El generador acepta **dos formas** para cada entrada de `consumed[]`. La forma que aplica se determina por la presencia o ausencia del campo `command:`.

---

#### Forma A — Lightweight (derivada del use case)

El generador busca un UC con `trigger.kind: event` cuyo `trigger.consumes` (o alias `trigger.event`) coincide con el `name`. A partir de ese UC deriva automáticamente el `command`, el `useCase`, el `producer` y el `filterExpr`. Esta es la forma habitual.

```yaml
domainEvents:
  consumed:
    - name: ProductActivated          # requerido
      sourceBc: catalog               # para validaciones INT-007 / INT-020
      channel: catalog.product.activated  # opcional pero recomendado
      payload:                        # subconjunto del published[].payload[] del productor
        - name: productId
          type: Uuid
        - name: sku
          type: String(50)
        - name: price
          type: Money
# El generador busca: useCases[trigger.kind=event, trigger.consumes=ProductActivated]
# y de ese UC deriva: command = uc.name, useCase = uc.id, filterExpr = uc.trigger.filter
```

**Qué pasa si no existe un UC con `trigger.kind: event` para este evento:**
El generador emite un `warn` y NO genera listener. El evento queda en la topología RabbitMQ/Kafka (cola declarada) pero sin handler Java.

---

#### Forma B — Full form (declaración explícita)

Cuando `command:` está presente, el generador usa la entrada tal cual **sin buscar ningún UC**.
Útil cuando el listener debe existir sin un UC formal (p.ej. adaptadores legados, handlers de compensación de saga sin UC propio).

```yaml
domainEvents:
  consumed:
    - name: OrderPlaced               # requerido
      command: ReserveStock           # requerido para activar forma B
                                      # → genera ReserveStockCommand + ReserveStockRabbitListener
      producer: orders                # opcional — aparece en Javadoc del listener
      useCase: UC-INV-010             # opcional — aparece en Javadoc del listener (fallback: command)
      sourceBc: orders                # solo validación INT-020; no afecta código generado
      channel: orders.order.placed    # opcional — usado en topología y Javadoc
      queueKey: inventory-order-placed  # opcional — default: {bc}-{event-kebab}
      filterExpr: "fields.get(\"status\").equals(\"CONFIRMED\")"  # opcional — guard en el listener
      payload:
        - name: orderId
          type: Uuid
        - name: items
          type: List[OrderLineSnapshot]
```

---

#### Tabla completa de propiedades de `consumed[]`

| Propiedad | Forma | Leída por | Requerido | Descripción |
|---|---|---|---|---|
| `name` | A y B | generador + validador | ✅ | Nombre del evento (PascalCase). Genera `{Name}RabbitListener` / `{Name}KafkaListener`. Debe estar declarado en `published[]` del BC productor (INT-007). |
| `command` | **B** | generador | ✅ en forma B | Nombre del use case **sin** el sufijo `Command`. Genera `{Command}Command` y el listener que lo despacha. Su presencia activa la forma B. |
| `producer` | **B** | generador | no | Nombre del BC productor. Solo aparece en el Javadoc del listener: `Consumes events produced by: {producer}`. Default: `'unknown'`. En forma A se deriva del primer segmento de `channel` (`channel.split('.')[0]`). |
| `useCase` | **B** | generador | no | ID o nombre del UC para el Javadoc del listener: `Dispatches to use case: {useCase}`. Fallback: valor de `command`. En forma A se toma de `uc.id`. |
| `sourceBc` | A y B | **solo validador** | no | BC que publica el evento. Lo lee `integration-validator.js` para INT-007 (el evento debe estar en `published[]` del BC declarado) e INT-020 (los campos del payload deben ser subconjunto del payload del publicador). **No afecta ningún archivo Java generado.** Alias aceptado: `from`. |
| `channel` | A y B | generador + topología | no | Canal AsyncAPI. En topología RabbitMQ se usa para derivar el routing key. En forma A: el generador deriva `producer` como el primer segmento (`orders.order.placed` → `orders`). Si se omite, canal se deriva como `{eventKebab}`. |
| `queueKey` | A y B | generador (RabbitMQ) | no | Key de la cola en `rabbitmq.yaml` y en la property `${queues.{queueKey}}` del listener. Default: `{bc}-{event-name-kebab}` (ej: `inventory-order-placed`). |
| `topicKey` | A y B | generador (Kafka) | no | Equivalente de `queueKey` para Kafka. Property `${topics.{topicKey}}`. Default: mismo cálculo que `queueKey`. |
| `payload` | A y B | generador | no | Campos del evento que el listener extrae de `event.data()`. Cada campo genera una línea de extracción tipada en el listener. Si se omite en forma A, el generador intenta derivar los campos desde `uc.input[]` o desde los `params` del `domainMethod`. Si tampoco hay `uc.input[]`, el command queda vacío (`new XyzCommand()` sin args). |
| `filterExpr` | **B** | generador | no | Expresión Java booleana evaluada sobre los campos extraídos. Si la expresión es `false`, el listener hace `basicAck` sin despachar el command (skip silencioso). En forma A se deriva de `uc.trigger.filter`. |

> **Propiedades ignoradas con GEN-WARN:**
> - `retry:` — emite `[bc-yaml-reader] GEN-WARN: ... "retry" is ignored`. Configura en `system.yaml` o archivos de entorno.
> - `dlq:` — emite `[bc-yaml-reader] GEN-WARN: ... "dlq" is ignored`. Configura en `system.yaml` o archivos de entorno.

> **`sourceBc` vs `producer` — distinción crítica:**
> | Campo | Quién lo lee | Dónde aparece |
> |---|---|---|
> | `sourceBc` | `integration-validator.js` | Validaciones INT-007 e INT-020. **No aparece en código Java.** |
> | `producer` | `messaging-generator.js` | Javadoc del listener: `Consumes events produced by: {producer}`. |
> Si quieres ambos comportamientos, declara los dos campos con el mismo valor.

#### Artefactos generados

El generador produce **un listener por evento consumido** (uno por broker). La clase generada
difiere según el broker seleccionado en `system.yaml`.

#### Listener RabbitMQ — `{EventName}RabbitListener.java`

**Package:** `{pkg}.{bc}.infrastructure.rabbitListener`

**Annotation principal:** `@RabbitListener(queues = "${queues.{queueKey}}")`
- `queueKey` se deriva como `{bc}-{event-name-kebab}` (ej: `inventory-product-activated`)
- Si `channel` está declarado en `consumed[]`, el routing key de la cola se alinea con el canal

**Firma del método `handle`:**
```java
@RabbitListener(queues = "${queues.inventory-product-activated}")
public void handle(Message message, Channel channel) throws IOException
```

**Patrón de ACK real:**
| Escenario | Código |
|---|---|
| Éxito | `channel.basicAck(deliveryTag, false)` |
| Error de deserialización (fatal) | `channel.basicNack(deliveryTag, false, false)` → DLQ inmediato |
| `DomainException` (error de negocio) | `channel.basicNack(deliveryTag, false, false)` → DLQ inmediato |
| `RuntimeException` (error de infraestructura) | `throw e` → política de retry de RabbitMQ |
| Evento duplicado (idempotencia activa) | `channel.basicAck(deliveryTag, false)` → skip silencioso |
| Filtro no coincide (`trigger.filter`) | `channel.basicAck(deliveryTag, false)` → skip silencioso |

**Ejemplo completo generado** (BC `inventory`, evento `ProductActivated`, broker RabbitMQ):

```java
package com.canastaShop.inventory.infrastructure.rabbitListener;

import com.canastaShop.inventory.application.commands.CreateStockItemCommand;
import com.canastaShop.shared.domain.customExceptions.DomainException;
import com.canastaShop.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import com.canastaShop.shared.infrastructure.eventEnvelope.EventEnvelope;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;

/**
 * RabbitMQ listener for queue ${queues.inventory-product-activated}.
 * Consumes events produced by: catalog.
 * Dispatches to use case: CreateStockItem.
 * derived_from: domainEvents.consumed.ProductActivated
 */
@Component("inventory.ProductActivatedRabbitListener")
public class ProductActivatedRabbitListener {

    private static final Logger log = LoggerFactory.getLogger(ProductActivatedRabbitListener.class);

    private final UseCaseMediator useCaseMediator;
    private final ObjectMapper objectMapper;

    public ProductActivatedRabbitListener(UseCaseMediator useCaseMediator, ObjectMapper objectMapper) {
        this.useCaseMediator = useCaseMediator;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = "${queues.inventory-product-activated}")
    public void handle(Message message, Channel channel) throws IOException {
        long deliveryTag = message.getMessageProperties().getDeliveryTag();

        // Deserializar el mensaje
        EventEnvelope<Map<String, Object>> event;
        try {
            event = objectMapper.readValue(
                message.getBody(),
                new TypeReference<EventEnvelope<Map<String, Object>>>() {});
        } catch (JsonProcessingException e) {
            log.error("Fatal deserialization error — sending to DLQ: {}", e.getMessage());
            channel.basicNack(deliveryTag, false, false);
            return;
        }

        // Extraer campos del payload
        UUID productId = objectMapper.convertValue(event.data().get("productId"), UUID.class);
        String sku     = objectMapper.convertValue(event.data().get("sku"),       String.class);

        // Despachar command
        try {
            useCaseMediator.dispatch(new CreateStockItemCommand(productId, sku));
            channel.basicAck(deliveryTag, false);
        } catch (DomainException e) {
            log.error("Domain error — sending to DLQ immediately. queue={}, error={}",
                message.getMessageProperties().getConsumerQueue(), e.getMessage(), e);
            channel.basicNack(deliveryTag, false, false);
        } catch (RuntimeException e) {
            log.warn("Infrastructure error — will retry. queue={}, error={}",
                message.getMessageProperties().getConsumerQueue(), e.getMessage(), e);
            throw e;
        }
    }
}
```

> **Puntos clave del código real:**
> - `event.data()` — no `event.payload()`. El envelope separa metadatos (`event.metadata()`) de datos (`event.data()`).
> - `objectMapper.convertValue(event.data().get("fieldName"), Type.class)` — extracción tipada campo a campo, **no** cast directo.
> - `useCaseMediator.dispatch()` — no `.send()` ni `.execute()`.
> - El `@Component` lleva el nombre calificado: `"{bc}.{ListenerClassName}"`.
> - El listener **no** implementa retry manual — el retry lo gestiona la política de cola RabbitMQ configurada por `BcRabbitMQConfig`.

#### Listener Kafka — `{EventName}KafkaListener.java`

**Package:** `{pkg}.{bc}.infrastructure.kafkaListener`

**Annotation principal:** `@KafkaListener(topics = "${topics.{topicKey}}", groupId = "${spring.kafka.consumer.group-id}")`
- `topicKey` se deriva igual que `queueKey`: `{bc}-{event-name-kebab}`

**Firma del método `handle`:**
```java
@KafkaListener(topics = "${topics.inventory-product-activated}", groupId = "${spring.kafka.consumer.group-id}")
public void handle(ConsumerRecord<String, String> record, Acknowledgment acknowledgment)
```

**Patrón de ACK real:**
| Escenario | Código |
|---|---|
| Éxito | `acknowledgment.acknowledge()` — commit manual del offset |
| Error de deserialización (fatal) | `acknowledgment.acknowledge()` → skip silencioso (no retry infinito) |
| Error al despachar | Sin `acknowledge()` → el offset no avanza; el broker reentrega |
| Evento duplicado (idempotencia activa) | `acknowledgment.acknowledge()` → skip silencioso |

**Diferencias respecto a RabbitMQ:**
- El segundo parámetro es `Acknowledgment acknowledgment` (Spring Kafka), no `Channel channel` (AMQP).
- La fuente del mensaje es `record.value()` (String), no `message.getBody()` (byte[]).
- No hay soporte de `trigger.filter` en el template Kafka — solo en RabbitMQ.
- No hay `DomainException`/`RuntimeException` split: cualquier excepción deja el offset sin comprometer.

#### Convención de nombres de cola / topic

| BC | Evento | Queue/Topic key derivado | Property reference |
|---|---|---|---|
| `inventory` | `ProductActivated` | `inventory-product-activated` | `${queues.inventory-product-activated}` / `${topics.inventory-product-activated}` |
| `orders` | `CartCheckedOut` | `orders-cart-checked-out` | `${queues.orders-cart-checked-out}` |
| `catalog` | `CategoryDeactivated` | `catalog-category-deactivated` | `${queues.catalog-category-deactivated}` |

El generador infiere el key como `{bc}-{eventNameKebab}` si no está declarado explícitamente en `consumed[]`.

#### Vinculación con el use case (`trigger.kind: event`)

El generador determina el command a instanciar buscando el UC con `trigger.kind: event` cuyo
`trigger.event` (o `trigger.consumes`) coincide con el `name` del evento consumido.

- El nombre del command es `{UC.name}Command` (ej: UC `CreateStockItem` → `CreateStockItemCommand`).

**Dos comportamientos según `uc.input[]`:**

| Caso | Comportamiento |
|---|---|
| UC **sin** `uc.input[]` (o solo campos `source: authContext`) | Command es `record XyzCommand() {}` (vacío). El listener llama `new XyzCommand()` sin argumentos. El handler resuelve lo que necesita desde el repositorio usando los IDs disponibles en el contexto del evento. |
| UC **con** `uc.input[]` | Los campos declarados en `uc.input[]` (excepto `source: authContext`) definen los campos del command record. El listener extrae **solo** esos campos del `event.data()` y los pasa al constructor. |

Cuando `uc.input[]` está declarado:
- La extracción en el listener se limita a los campos de `uc.input[]` — no hay variables extraídas sin usar.
- Los tipos se resuelven contra los `valueObjects[]` y `enums[]` del BC consumidor.
- Los campos `Uuid` se mantienen como `UUID` en el command record (no se convierten a `String`).
- Los campos `List[VO]` usan `constructCollectionType(List.class, VO.class)` para deserialización.

Si `payload` se omite del `consumed[]` **y** `uc.input[]` también está ausente, el generador intenta
derivar el payload desde los `params` del `domainMethod` del UC — si no puede resolverlos, el command
queda vacío.

> **Recomendación:** Para UCs que necesitan datos del evento, declarar siempre `payload[]` en
> `consumed[]` y `uc.input[]` en el use case. Esto hace explícito el contrato y produce código compilable.

#### Tipos complejos en `consumed[].payload[]` — `eventDtos[]` (recomendado)

La forma **arquitectónicamente correcta** de consumir un tipo de snapshot del productor es declararlo
en la sección `eventDtos[]` del BC consumidor. Esto genera un Java `record` en
`{bc}.application.dtos.incoming` — que es la capa correcta para datos de entrada externos, sin
contaminar `domain.valueobject` con conceptos del BC productor.

```yaml
# BC consumidor: ordering.yaml
eventDtos:
  - name: OrderLineSnapshot      # nombre del record Java
    sourceBc: sales              # documentación; no genera validación INT-*
    properties:
      - name: productId
        type: Uuid
      - name: quantity
        type: Integer
      - name: unitPrice
        type: Decimal
        precision: 10
        scale: 2

useCases:
  - id: process-placed-order
    name: ProcessPlacedOrder
    type: command
    trigger:
      kind: event
      event: OrderPlaced
    input:
      - name: lines
        type: List[OrderLineSnapshot]   # resuelve contra eventDtos[]
        source: body
    implementation: scaffold

domainEvents:
  consumed:
    - name: OrderPlaced
      channel: sales.order.placed
      payload:
        - name: lines
          type: List[OrderLineSnapshot]   # resuelve contra eventDtos[]
```

**Código generado — EventDto record:**
```java
// application/dtos/incoming/OrderLineSnapshot.java
package com.example.ordering.application.dtos.incoming;

import java.math.BigDecimal;
import java.util.UUID;

// derived_from: eventDto:OrderLineSnapshot
// source_bc: sales
public record OrderLineSnapshot(UUID productId, Integer quantity, BigDecimal unitPrice) {}
```

**Código generado — command record:**
```java
// ProcessPlacedOrderCommand.java
import com.example.ordering.application.dtos.incoming.OrderLineSnapshot;
import java.util.List;

public record ProcessPlacedOrderCommand(
    @NotNull List<OrderLineSnapshot> lines
) implements Command {}
```

**Código generado — listener:**
```java
List<OrderLineSnapshot> lines = objectMapper.convertValue(
    event.data().get("lines"),
    objectMapper.getTypeFactory().constructCollectionType(List.class, OrderLineSnapshot.class));

useCaseMediator.dispatch(new ProcessPlacedOrderCommand(lines));
```

#### Propiedades de `eventDtos[]`

| Campo | Requerido | Descripción |
|---|---|---|
| `name` | ✅ | Nombre PascalCase del record Java. |
| `sourceBc` | No | Nombre del BC productor. Solo documentación — no genera validación. |
| `properties[]` | ✅ | Propiedades del record. Misma estructura que `valueObjects[].properties[]`. |
| `properties[].name` | ✅ | Nombre camelCase del campo Java. |
| `properties[].type` | ✅ | Tipo canónico, enum, otro eventDto (mismo BC), o VO del dominio propio. |

**Resolución de tipos en `eventDtos[].properties[]`:**
1. Tipos canónicos (`Uuid`, `String`, `Decimal`, `Money`, …) → via `mapType()`
2. `Enum<X>` o enum declarado en `enums[]` → importa desde `domain.enums`
3. Nombre de otro `eventDto` de este BC (mismo paquete) → sin import
4. VO declarado en `valueObjects[]` de este BC → importa desde `domain.valueobject`

> **Nota:** Los `eventDtos[]` generan Java `record` sin lógica de negocio.
> No implementan ninguna interfaz de dominio. Son data carriers puros.

#### Alternativa legacy — Option A (desaconsejada)

La alternativa anterior consistía en re-declarar el tipo en `valueObjects[]`.
Esto generaba un `final class` en `domain.valueobject`, que es arquitectónicamente incorrecto
(el snapshot externo contamina el modelo de dominio propio).

Option A sigue siendo compatible (no hay breaking change), pero **se recomienda migrar
a `eventDtos[]`** en diseños nuevos.

> **GEN-WARN-001:** Si un tipo en `consumed[].payload[]` no es escalar, enum, valueObject ni
> eventDto del BC consumidor, el generador emite un warning con instrucciones para declararlo
> en `eventDtos[]` (recomendado) o `valueObjects[]` (Option A). El código generado
> tendrá imports rotos si no se corrige.

---

### 2.5 EventMetadata canónico

Cuando la configuración `events.metadata.enabled: true` (default), cada evento publicado
incluye automáticamente un componente `EventMetadata` como primer campo del record.
Este componente es un record canónico compartido por todos los eventos del sistema.

```java
// shared/domain/EventMetadata.java (generado como clase compartida)
public record EventMetadata(
    UUID eventId,           // UUID v4 único por instancia de evento
    String eventType,       // nombre del evento (e.g. "ProductActivated")
    int eventVersion,       // versión del contrato como entero (e.g. 1)
    Instant occurredAt,     // Instant.now() en el momento del raise()
    String sourceBc,        // bounded context que generó el evento (e.g. "catalog")
    String correlationId,   // ID de correlación — String, propagado por la capa de mensajería
    String causationId      // ID del evento/command causante — String, propagado por la capa de mensajería
) {
    /**
     * Usado por los agregados al hacer raise().
     * correlationId y causationId se dejan en null — la capa de mensajería
     * (DomainEventHandler) los propaga desde el contexto ambient antes de publicar.
     */
    public static EventMetadata now(String eventType, int eventVersion, String sourceBc) {
        return new EventMetadata(
            UUID.randomUUID(),
            eventType,
            eventVersion,
            Instant.now(),
            sourceBc,
            null,   // correlationId: propagado por DomainEventHandler desde MDC
            null    // causationId:   propagado por DomainEventHandler desde MDC
        );
    }
}
```

> **Filtro de campos del payload:** si el `published[].payload[]` declara campos con
> los mismos nombres que los del `EventMetadata` canónico (`eventId`, `eventType`,
> `eventVersion`, `occurredAt`, `correlationId`, `causationId`), el generador emite una
> advertencia de deprecación y filtra esos campos del payload para evitar duplicados.
> La información ya está en `EventMetadata`. Nota: `sourceBc` no está en la lista de filtrado
> porque el payload raramente declara un campo con ese nombre; se mantiene si se declara.

> **Dos clases EventMetadata:** el generador produce dos records con este nombre en paquetes distintos.
> `shared.domain.EventMetadata` — adjuntado al DomainEvent (levantado por el agregado), usa `now()` para capturar
> el instante del evento. `shared.infrastructure.eventEnvelope.EventMetadata` — adjuntado al EventEnvelope
> (formato wire), usa `create(String eventType, String correlationId)` y tiene campos `eventId: String`,
> `timestamp: String`, `source: String`. Son clases distintas; la documentación de esta sección cubre
> la de dominio.

---

## 3. Validaciones cruzadas (INT-*)

El generador ejecuta un conjunto de validaciones cruzadas entre `system.yaml`, los
`{bc}.yaml`, los OpenAPI y los AsyncAPI. Cuando fallan con nivel `error`, la build se
detiene.

| Código | Nivel | Descripción |
|---|---|---|
| **INT-001** | error | Cada evento declarado en `system.integrations[]` debe existir en `domainEvents.published[]` del BC `from`. |
| **INT-002** | error | Cada evento declarado en `system.integrations[]` debe existir en `domainEvents.consumed[]` del BC `to`. |
| **INT-003** | error | Una integración `pattern: customer-supplier` + `channel: http` requiere `{to}-internal-api.yaml` + entradas recíprocas en `integrations.inbound[]` (BC `to`) y `integrations.outbound[]` (BC `from`). Los nombres de operación se validan contra `{bc}.yaml#/integrations.inbound[].operations[].name`. |
| **INT-004** | error | Una integración `pattern: acl` + `channel: http` requiere que `to` exista en `system.externalSystems[]`. |
| **INT-005** | warn | El `channel` declarado en `domainEvents.published[]` no sigue la convención `{bc}.{kebab-event-name}`. |
| **INT-006** | error | Cada `integrations.outbound[]` debe tener un recíproco en `system.integrations[]` (`from` = BC actual, `to` = `outbound.name`). |
| **INT-007** | error | Cada `domainEvents.consumed[].name` debe estar declarado en `domainEvents.published[]` de algún otro BC. |
| **INT-008** | warn/error | Operación declarada en `system.integrations[].contracts[]` (patrón ACL) no está declarada en `externalSystems[name=target].operations[]`. |
| **INT-009** | error | Operación declarada en `bc.integrations.outbound[type=externalSystem]` no coincide con ninguna en `externalSystems[name=target].operations[].name`. |
| **INT-010** | error | Una projection con `persistent: true` debe declarar `source.kind: event` y el evento debe estar publicado por el BC `source.from`. |
| **INT-011** | error | Una projection persistente debe declarar `keyBy` apuntando a una propiedad existente. |
| **INT-012** | error | Dos usos: (1) `additionalSources` de una projection persistente debe referenciar un evento publicado por el BC `from` declarado. (2) Cada `step.triggeredBy` en una saga debe ser el evento trigger de la saga o estar publicado por algún BC. |
| **INT-013** | error | `saga.trigger.event` debe estar en `domainEvents.published[]` del BC `saga.trigger.bc`. |
| **INT-014** | error | `saga.step.onSuccess` / `step.onFailure` deben estar publicados por el BC del step. `step.compensation` debe estar publicado por algún BC. |
| **INT-015** | error | Una integración HTTP con `auth.type: oauth2-cc` debe declarar `tokenEndpoint` y `credentialKey`. |
| **INT-016** | error | Cada mensaje referenciado en un canal del AsyncAPI debe estar declarado en `domainEvents.published[]` o `domainEvents.consumed[]` del mismo BC. |
| **INT-017** | error | Cada `domainEvents.published[].name` debe tener una entrada en el AsyncAPI del BC (mensaje + canal). |
| **INT-018** | warn | El `channel` en `domainEvents.published[]` no coincide con ningún canal del AsyncAPI que referencie el mensaje correspondiente. |
| **INT-019** | error/warn | Campo de `published[].payload[]` ausente en el schema del AsyncAPI → **error**. Campo presente pero con tipo incompatible (drift) → **warn**. |
| **INT-020** | error | Los campos de `consumed[].payload[]` deben ser un subconjunto de los campos del `published[].payload[]` del BC productor. |
| **INT-021** | error | Un campo del `published[].payload[]` coincide con una propiedad `hidden: true` del agregado pero no tiene `allowHiddenLeak: true`. |
| **INT-022** | error | Campo de `externalSystems[].operations[].request\|response.fields[]` con tipo no escalar que no está declarado en `externalSystems[].schemas`. |
| **INT-023** | error | Campo dentro de `externalSystems[].schemas[schemaName]` con tipo que no es escalar ni referencia a otro schema del mismo sistema externo. |
| **INT-024** | error | `auth.type` con valor desconocido. Valores válidos: `api-key`, `bearer`, `oauth2-cc`, `mTLS`, `internal-jwt`, `none`. |
| **INT-025** | error | Un campo de `domainEvents.published[].payload[]` declara `source: auth-context`. Este origen no está permitido en el payload de eventos: el agregado debe ser agnóstico a la seguridad. Declarar el campo como `source: param`, añadirlo a `domainMethods[].params` y resolver el valor de `SecurityContext` en el handler de aplicación. |
| **INT-026** | error | Un campo de `domainEvents.published[].payload[]` declara `source: param` pero ningún `domainMethod` que emita ese evento declara un parámetro con el nombre referenciado (`param:` o `name:`). El generador emitiría `null` silenciosamente en el evento publicado, causando pérdida de datos en runtime. Añadir el parámetro a `domainMethods[].params[]` o corregir el nombre. |
| **INT-027** | warn | Una projection persistente declara `upsertStrategy: versionGuarded` pero el evento fuente (primary o additionalSources) no incluye el campo de versión en su `payload[]`. El guard degeneraría silenciosamente a `lastWriteWins` en runtime. Añadir el campo de versión al evento o cambiar la estrategia. |

---

## 4. Ejemplos completos

### Ejemplo 1: BC con outbound HTTP hacia otro BC interno

```yaml
bc: inventory
type: bounded-context

integrations:
  outbound:
    - name: catalog
      protocol: http
      operations:
        - name: getCatalogProductById
          description: Validates product existence before creating a stock item.
        - name: checkCategoryExists
          description: Validates category is active.
      resilience:
        circuitBreaker:
          failureRateThreshold: 60
          waitDurationInOpenState: 60s
          slidingWindowSize: 20
        retries:
          maxAttempts: 3
          waitDuration: 500ms
        connectTimeoutMs: 5000
        timeoutMs: 3000
      auth:
        type: oauth2-cc
        tokenEndpoint: https://auth.internal/oauth/token
        credentialKey: inventory-catalog-client-creds
```

### Ejemplo 2: BC con eventos publicados y consumidos

```yaml
bc: catalog
type: bounded-context

domainEvents:
  published:
    - name: ProductActivated
      scope: integration
      channel: catalog.product.activated
      payload:
        - name: productId
          type: Uuid
          source: aggregate
          field: id
        - name: sku
          type: String(50)
          source: aggregate
          field: sku
        - name: price
          type: Money
          source: aggregate
          field: price
        - name: activatedAt
          type: DateTime
          source: timestamp
        - name: activatedBy
          type: Uuid
          source: param          # ← debe ser param; source: auth-context está prohibido en payload (INT-025)

    - name: ProductDeactivated
      scope: both                # interno Y hacia el broker
      channel: catalog.product.deactivated
      payload:
        - name: productId
          type: Uuid
          source: aggregate
          field: id
        - name: reason
          type: String
          source: param          # se pasa explícitamente al método raise()
        - name: deactivatedAt
          type: DateTime
          source: timestamp

  consumed:
    - name: CategoryDeactivated
      sourceBc: categories
      payload:
        - name: categoryId
          type: Uuid
        - name: deactivatedAt
          type: DateTime
```

### Ejemplo 3: Use case activado por evento (vinculación con `trigger.kind: event`)

```yaml
# En el bc.yaml del BC consumidor (inventory):
useCases:
  - id: UC-INV-010
    name: CreateStockItem
    type: command
    trigger:
      kind: event
      consumes: ProductActivated    # referencia al evento en domainEvents.consumed
      fromBc: catalog
      channel: catalog.product.activated
    aggregate: StockItem
    method: create
    input:
      - name: productId
        type: Uuid
        source: body
        required: true
      - name: sku
        type: String(50)
        source: body
        required: true
    emits: StockItemCreated
    implementation: scaffold

domainEvents:
  consumed:
    - name: ProductActivated
      sourceBc: catalog
      payload:
        - name: productId
          type: Uuid
        - name: sku
          type: String(50)
        - name: price
          type: Money
```

El generador produce el consumer listener que extrae los campos de `uc.input[]` del evento y los
convierte en los parámetros del command:

```java
@Component("inventory.ProductActivatedRabbitListener")
public class ProductActivatedRabbitListener {

    private final UseCaseMediator useCaseMediator;
    private final ObjectMapper objectMapper;

    @RabbitListener(queues = "${queues.inventory-product-activated}")
    public void handle(Message message, Channel channel) throws IOException {
        long deliveryTag = message.getMessageProperties().getDeliveryTag();

        EventEnvelope<Map<String, Object>> event = objectMapper.readValue(
                message.getBody(),
                new TypeReference<EventEnvelope<Map<String, Object>>>() {});

        // extrae solo los campos de uc.input[]
        String productId = objectMapper.convertValue(event.data().get("productId"), String.class);
        String sku       = objectMapper.convertValue(event.data().get("sku"),       String.class);

        try {
            useCaseMediator.dispatch(new CreateStockItemCommand(productId, sku));
            channel.basicAck(deliveryTag, false);
        } catch (DomainException e) {
            channel.basicNack(deliveryTag, false, false);
        } catch (RuntimeException e) {
            throw e;
        }
    }
}
```

---

## Referencia rápida: convención de canales

El nombre del canal sigue la convención:
`{bc}.{kebab-event-name-con-puntos}`

| BC | Evento | Canal resultante |
|---|---|---|
| `catalog` | `ProductActivated` | `catalog.product.activated` |
| `catalog` | `ProductPriceUpdated` | `catalog.product.price.updated` |
| `orders` | `OrderPlaced` | `orders.order.placed` |
| `orders` | `OrderDraftCreated` | `orders.order.draft.created` |
| `payments` | `PaymentCaptured` | `payments.payment.captured` |

La validación INT-005 emite un `warn` si el `channel` declarado en el YAML no sigue
esta convención; la build no se detiene pero el humano debe corregirlo.

---

## 5. Artefactos de infraestructura RabbitMQ generados

Cuando el build se ejecuta con `broker: rabbitmq` (declarado en `system.yaml`), el generador
produce tres tipos de artefactos de configuración. Ninguno requiere declaración adicional en el
`{bc}.yaml` — se derivan completamente de `domainEvents.published[]` y `domainEvents.consumed[]`.

### Conceptos: DLX y DLQ

**DLQ (Dead Letter Queue)** — Cola de mensajes muertos. Es una queue normal donde van a parar
los mensajes que no pudieron ser procesados correctamente (errores de negocio, errores de
deserialización, reintentos agotados). Sirve para inspección, re-procesamiento manual o archivado.

**DLX (Dead Letter Exchange)** — Exchange enrutador de mensajes muertos. No es una queue — es
un exchange intermedio. Cuando RabbitMQ decide que un mensaje "muere" (la queue lo rechaza con
`requeue=false` o agota los reintentos), lo envía al DLX. El DLX lo enruta a la DLQ correcta
usando una routing-key.

```
Producer
   │
   ▼
Exchange principal  ──routing-key──▶  Queue normal
                                           │
                                    basicNack(requeue=false)
                                    o max-attempts agotado
                                           │
                                           ▼
                                       DLX Exchange  ──routing-key──▶  DLQ
```

**¿Por qué existe el DLX en lugar de ir directo a la DLQ?**
El DLX permite flexibilidad de enrutamiento: el mismo DLX puede enrutar distintos tipos de
mensajes muertos a DLQs diferentes según la routing-key. Si fuera directo queue → DLQ, cada
queue solo podría tener una DLQ fija sin capacidad de distinguir.

La vinculación se declara en la queue principal mediante el argumento AMQP:
```java
QueueBuilder.durable("inventory.order-placed")
    .withArgument("x-dead-letter-exchange", "orders.events.dlx")       // ← apunta al DLX
    .withArgument("x-dead-letter-routing-key", "order.placed.dead")    // ← opcional
    .build();
```
Y la DLQ se enlaza al DLX:
```java
BindingBuilder.bind(dlqQueue).to(dlxExchange).with("order.placed.dead");
```

---

---

### 5.1 `parameters/{env}/rabbitmq.yaml`

**Ubicación:** `src/main/resources/parameters/{env}/rabbitmq.yaml`  
**Entornos:** `local`, `develop`, `test`, `production`  
**Importado desde:** `application-{env}.yaml` vía `spring.config.import`

Cada archivo contiene dos partes: la **conexión al broker** y la **topología** (exchanges, queues, routing-keys) derivada de todos los BCs del sistema.

#### Sección `spring.rabbitmq` — conexión y listener

Las propiedades de conexión varían por entorno: `local` y `test` usan valores literales; `develop` y `production` usan variables de entorno.

| Propiedad | `local` / `test` | `develop` | `production` |
|---|---|---|---|
| `host` | `localhost` | `${RABBITMQ_HOST:localhost}` | `${RABBITMQ_HOST}` (sin default) |
| `port` | `5672` | `${RABBITMQ_PORT:5672}` | `${RABBITMQ_PORT:5672}` |
| `username` | `guest` | `${RABBITMQ_USERNAME:guest}` | `${RABBITMQ_USERNAME}` (sin default) |
| `password` | `guest` | `${RABBITMQ_PASSWORD:guest}` | `${RABBITMQ_PASSWORD}` (sin default) |
| `virtual-host` | `/` | `${RABBITMQ_VHOST:/}` | `${RABBITMQ_VHOST:/}` |
| `publisher-confirm-type` | `correlated` | `correlated` | `correlated` |
| `publisher-returns` | `true` | `true` | `true` |

**`publisher-confirm-type: correlated`** — habilita las confirmaciones broker→productor (`ConfirmCallback`). El `RabbitTemplate` loguea error cuando `ack = false`.

**`publisher-returns: true`** — habilita el `ReturnsCallback` para mensajes no enrutables (ninguna queue recibió el mensaje).

#### Sección `listener.simple` — consumidor

| Propiedad | `local` / `develop` | `test` | `production` |
|---|---|---|---|
| `acknowledge-mode` | `manual` | `manual` | `manual` |
| `concurrency` | `3` | `1` | `5` |
| `max-concurrency` | — | — | `20` |
| `prefetch` | `5` | `1` | `10` |

- **`acknowledge-mode: manual`** — el listener llama explícitamente a `channel.basicAck()` / `channel.basicNack()`. Coordinado con `AcknowledgeMode.MANUAL` en `SimpleRabbitListenerContainerFactory`.
- **`concurrency`** — número de threads consumidores por listener container.
- **`max-concurrency`** — techo de escalado dinámico del container (solo `production`).
- **`prefetch`** — máximo de mensajes en vuelo por consumer antes de esperar ack.

#### Sección `listener.simple.retry` — backoff exponencial

| Propiedad | `local` / `develop` | `test` | `production` |
|---|---|---|---|
| `enabled` | `true` | `true` | `true` |
| `max-attempts` | `3` | `2` | `5` |
| `initial-interval` (ms) | `1500` | `500` | `2000` |
| `multiplier` | `2.0` | `1.0` | `2.0` |
| `max-interval` (ms) | `30000` | `1000` | `30000` |
| `stateless` | `true` | `true` | `true` |

Estos valores son consumidos directamente por `@Value` en `RabbitMQConfig.java` y pasados al `RetryInterceptorBuilder`. Cuando `max-attempts` se agota, el interceptor lanza `AmqpRejectAndDontRequeueException` → el broker mueve el mensaje a la DLQ.

#### Propiedades adicionales solo en `production`

| Propiedad | Valor | Rol |
|---|---|---|
| `connection-timeout` | `5000` ms | Tiempo máximo de espera para establecer conexión TCP con el broker. |
| `requested-heartbeat` | `60` s | Intervalo de heartbeat AMQP para detectar conexiones caídas. |
| `cache.channel.size` | `25` | Tamaño del pool de canales AMQP reutilizables por conexión. |
| `ssl.enabled` | `${RABBITMQ_SSL_ENABLED:false}` | Habilita TLS en el socket AMQP. |
| `template.mandatory` | `true` | Fuerza `ReturnsCallback` en `RabbitTemplate`; equivalente a `setMandatory(true)`. |

#### Sección `exchanges` / `queues` / `routing-keys` — topología

El generador calcula la topología leyendo los `domainEvents` de **todos** los BCs del sistema
y la escribe al final del mismo archivo, en las tres secciones de nivel raíz. Cada valor es
leído en runtime vía `@Value` — ningún nombre está hardcodeado en el código Java.

**Reglas de derivación** (implementadas en `buildRabbitMQTopology` de `messaging-generator.js`):

| Sección | Clave | Valor | Fuente |
|---|---|---|---|
| `exchanges` | `{bcName}` | `{bcName}.events` | Un exchange por BC que publica con `scope != internal` |
| `exchanges` (consumidor) | `{producerBc}` | `{producerBc}.events` | Derivado del primer segmento del `channel` del evento consumido |
| `queues` (publicado) | `{event-kebab}` | `{bcName}.{event-kebab}` | Un entry por evento publicado externo |
| `queues` (consumido) | `{consumerBc}-{event-kebab}` | `{consumerBc}.{event-kebab}` | O el `queueKey` declarado en el YAML si existe |
| `queues` (projection persistente) | `{bc}-projection-{proj-kebab}-{event-kebab}` | `{bc}.{key}` | Por cada `projection.persistent: true` |
| `routing-keys` (publicado) | misma clave que la queue | `{event.dot.case}` o el `channel` declarado | `channel` tiene precedencia sobre el nombre derivado |
| `routing-keys` (consumido) | misma clave que la queue | `{event.dot.case}` o el `channel` declarado | Ídem |

**Ejemplo** para un sistema con BC `orders` publicando `OrderPlaced` y BC `inventory` consumiéndolo:

```yaml
# src/main/resources/parameters/local/rabbitmq.yaml
spring:
  rabbitmq:
    host: localhost
    port: 5672
    username: guest
    password: guest
    virtual-host: /
    publisher-confirm-type: correlated
    publisher-returns: true
    listener:
      simple:
        acknowledge-mode: manual
        concurrency: 3
        prefetch: 5
        retry:
          enabled: true
          max-attempts: 3
          initial-interval: 1500
          multiplier: 2.0
          max-interval: 30000
          stateless: true

exchanges:
  orders: orders.events       # BC orders publica
  inventory: inventory.events # BC inventory también publica (si aplica)

queues:
  inventory-order-placed: inventory.order-placed  # consumer queue (clave = {consumer}-{event-kebab})

routing-keys:
  order-placed: order.placed              # canal declarado o event-name kebab→dot (clave = event-kebab)
  inventory-order-placed: order.placed    # el consumidor usa la misma routing-key del producer
```

> **Responsabilidad de las queues:** el BC **publicador** no declara queues para sus propios eventos — solo declara el exchange. Son los BCs **consumidores** quienes declaran sus propias queues y las enlazan al exchange del productor. Esto evita queues huérfanas sin consumer.

---

### 5.2 `RabbitMQConfig.java` — beans compartidos

**Ubicación:** `src/main/java/{package}/shared/infrastructure/configurations/rabbitmqConfig/RabbitMQConfig.java`

Un único archivo por servicio (no por BC). Provee los beans de infraestructura que todos los BC comparten.

```java
@Configuration
@EnableRabbit
public class RabbitMQConfig {

    // Valores leídos de spring.rabbitmq.listener.simple.retry.* en rabbitmq.yaml
    @Value("${spring.rabbitmq.listener.simple.retry.max-attempts:3}")
    private int maxAttempts;

    @Value("${spring.rabbitmq.listener.simple.retry.initial-interval:1500}")
    private long initialInterval;

    @Value("${spring.rabbitmq.listener.simple.retry.multiplier:2.0}")
    private double multiplier;

    @Value("${spring.rabbitmq.listener.simple.retry.max-interval:30000}")
    private long maxInterval;
    ...
}
```

| Bean | Tipo | Rol |
|---|---|---|
| `jsonMessageConverter` | `Jackson2JsonMessageConverter` | Serialización/deserialización JSON de todos los mensajes AMQP. Recibe el `ObjectMapper` del contexto (con los módulos de la aplicación). |
| `rabbitAdmin` | `RabbitAdmin` | Declara la topología (exchanges, queues, bindings) contra el broker al arrancar la aplicación. |
| `rabbitInitializer` | `ApplicationRunner` | Llama `rabbitAdmin.initialize()` en el startup para forzar la declaración anticipada de la topología antes de que los listeners comiencen a consumir. |
| `rabbitTemplate` | `RabbitTemplate` | Cliente de publicación. Configurado con `mandatory = true` + `ConfirmCallback` (loguea si el broker rechaza el mensaje) + `ReturnsCallback` (loguea si el mensaje no puede ser enrutado a ninguna queue). |
| `rabbitListenerContainerFactory` | `SimpleRabbitListenerContainerFactory` | Factory que aplica a todos los `@RabbitListener`. Configura: `AcknowledgeMode.MANUAL`, `defaultRequeueRejected = false` y el `RetryOperationsInterceptor` con backoff exponencial usando los valores de `@Value`. |

**Lógica del `RetryOperationsInterceptor`:**

```java
RetryOperationsInterceptor retryInterceptor = RetryInterceptorBuilder.stateless()
    .maxAttempts(maxAttempts)                           // spring.rabbitmq.listener.simple.retry.max-attempts
    .backOffOptions(initialInterval, multiplier, maxInterval)  // initial-interval, multiplier, max-interval
    .recoverer((message, cause) -> {
        // Se ejecuta cuando maxAttempts se agota:
        log.error("Message sent to DLQ after retry exhausted. queue={}, error={}", ...);
        throw new AmqpRejectAndDontRequeueException("Retry exhausted", cause);
        // ↑ basicNack con requeue=false → el broker mueve el mensaje a la DLQ
    })
    .build();
```

> El interceptor gestiona **reintentos en memoria** (dentro del mismo proceso). El mensaje
> no vuelve al broker entre reintentos — es backoff local. Solo cuando `maxAttempts` se agota
> el mensaje se rechaza y el broker lo mueve a la DLQ (`x-dead-letter-exchange`).

---

### 5.3 `{BcPascal}RabbitMQConfig.java` — topología por BC

**Ubicación:** `src/main/java/{package}/{bcName}/infrastructure/adapters/rabbitmqMessageBroker/{BcPascal}RabbitMQConfig.java`

Uno por BC con eventos. Lee todos los nombres via `@Value` — ningún string de exchange, queue
ni routing-key está hardcodeado. `RabbitAdmin` (del bean compartido) lo detecta al arrancar
y declara la topología contra el broker.

#### Beans generados por cada evento publicado (con `scope != internal`)

El BC publicador solo declara el exchange y su DLX. **No declara queues para sus propios eventos** — los BCs consumidores declaran sus propias queues enlazadas a este exchange. Esto evita queues huérfanas (sin consumer) que acumularían mensajes indefinidamente en el broker.

| Bean | Tipo | Nombre / referencia | Rol |
|---|---|---|---|
| `{bcCamel}Exchange` | `TopicExchange` | `${exchanges.{bcName}}` | Exchange principal del BC publicador. `durable = true`, `autoDelete = false`. |
| `{bcCamel}DlxExchange` | `TopicExchange` | `${exchanges.{bcName}}` + `.dlx` | Dead-Letter Exchange. Recibe los mensajes rechazados después de agotar reintentos. |

**Argumentos de queue generados condicionalmente** (solo aplican al lado consumidor — ver sección siguiente):

| Argumento AMQP | Cuándo se genera | Fuente en el YAML |
|---|---|---|
| `x-dead-letter-exchange` | **Siempre** en toda queue del consumidor | Hardcoded: `${exchanges.{producerBc}}.dlx` |
| `x-dead-letter-routing-key` | Solo si `broker.dlq.routingKey` está declarado en el evento **publicado** | `published[].broker.dlq.routingKey` |
| `x-delivery-limit` | Nunca generado (requiere quorum queue — configurar en el broker directamente) | — |
| `x-message-ttl` | Nunca generado (independiente del retry Spring — configurar en el broker directamente) | — |

> **Nota sobre `broker.dlq` en el publicador:** `dlq.routingKey` y `dlq.queueName` se declaran en el evento **publicado** del BC origen, no en el `consumed[]` del BC consumidor. El generador los propaga al `BcRabbitMQConfig` del BC consumidor cuando declara la queue. El BC publicador no crea queues — por tanto, aunque declare `broker.dlq.*`, solo afecta a las queues del lado consumidor.

> Los campos `retry` y `dlq` en `consumed[]` son ignorados por el generador (`GEN-WARN`).

#### Beans generados por cada evento consumido (agrupados por BC productor)

Por cada BC productor distinto que aparece en `consumed[]` (derivado del primer segmento del `channel`):

| Bean | Tipo | Nombre calificado (Spring) | Rol |
|---|---|---|---|
| `{bcCamel}_{producerCamel}Exchange` | `TopicExchange` | `"${bcCamel}_${producerCamel}Exchange"` | Exchange del BC productor. Bean name prefijado con el BC consumidor para evitar colisiones cuando múltiples BCs consumen del mismo productor. |
| `{bcCamel}_{producerCamel}DlxExchange` | `TopicExchange` | `"${bcCamel}_${producerCamel}DlxExchange"` | DLX del exchange del productor (visto desde este BC consumidor). |

Por cada evento consumido del productor:

| Bean | Tipo | Rol |
|---|---|---|
| `{eventCamel}Queue` | `Queue` | Queue durable del consumidor para este evento. `x-dead-letter-exchange` apunta al DLX del productor. |
| `{eventCamel}Binding` | `Binding` | Enlaza la queue al exchange del productor con la routing-key del evento. |
| `{eventCamel}Dlq` | `Queue` | DLQ del consumidor para este evento (`{queue}.dlq`). |
| `{eventCamel}DlqBinding` | `Binding` | Enlaza la DLQ al DLX del productor. |

**Ejemplo completo** — BC `inventory` que publica `StockReserved` y consume `OrderPlaced` del BC `orders`:

```java
// src/main/java/com/example/inventory/infrastructure/adapters/
//     rabbitmqMessageBroker/InventoryRabbitMQConfig.java

@Configuration
public class InventoryRabbitMQConfig {

    // ─── Publisher exchange for inventory ─────────────────────────────────────

    @Value("${exchanges.inventory}")
    private String inventoryExchangeName;           // valor: "inventory.events"

    @Bean
    public TopicExchange inventoryExchange() {
        return new TopicExchange(inventoryExchangeName, true, false);
    }

    @Bean
    public TopicExchange inventoryDlxExchange() {
        return new TopicExchange(inventoryExchangeName + ".dlx", true, false);
    }
    // Los BCs consumidores declaran sus propias queues enlazadas a este exchange.
    // El BC publicador no declara queues para sus propios eventos.

    // ─── Consumer: events from orders ─────────────────────────────────────────
    // Bean names prefixed with owning BC to avoid collisions when multiple BCs
    // consume from the same producer exchange.

    @Value("${exchanges.orders}")
    private String inventory_ordersExchangeName;    // valor: "orders.events"

    @Bean("inventory_ordersExchange")
    public TopicExchange inventory_ordersExchange() {
        return new TopicExchange(inventory_ordersExchangeName, true, false);
    }

    @Bean("inventory_ordersDlxExchange")
    public TopicExchange inventory_ordersDlxExchange() {
        return new TopicExchange(inventory_ordersExchangeName + ".dlx", true, false);
    }

    // ─── OrderPlaced (evento consumido de orders) ─────────────────────────────

    @Value("${queues.inventory-order-placed}")
    private String inventoryOrderPlacedQueueName;   // valor: "inventory.order-placed"

    @Value("${routing-keys.inventory-order-placed}")
    private String inventoryOrderPlacedRoutingKey;  // valor: "order.placed"

    @Bean
    public Queue inventoryOrderPlacedQueue() {
        return QueueBuilder.durable(inventoryOrderPlacedQueueName)
                .withArgument("x-dead-letter-exchange", inventory_ordersExchangeName + ".dlx")
                .build();
    }

    @Bean
    public Binding inventoryOrderPlacedBinding() {
        return BindingBuilder
                .bind(inventoryOrderPlacedQueue())
                .to(inventory_ordersExchange())
                .with(inventoryOrderPlacedRoutingKey);
    }

    @Bean
    public Queue inventoryOrderPlacedDlq() {
        return QueueBuilder.durable(inventoryOrderPlacedQueueName + ".dlq").build();
    }

    @Bean
    public Binding inventoryOrderPlacedDlqBinding() {
        return BindingBuilder
                .bind(inventoryOrderPlacedDlq())
                .to(inventory_ordersDlxExchange())
                .with(inventoryOrderPlacedRoutingKey);
    }
}
```

#### Convención de nombres de beans

| Elemento | Patrón del nombre del bean | Ejemplo |
|---|---|---|
| Exchange propio (publicador) | `{bcCamel}Exchange` | `inventoryExchange` |
| DLX propio (publicador) | `{bcCamel}DlxExchange` | `inventoryDlxExchange` |
| Exchange del productor (consumidor) | `"{bcCamel}_{producerCamel}Exchange"` | `"inventory_ordersExchange"` |
| DLX del productor (consumidor) | `"{bcCamel}_{producerCamel}DlxExchange"` | `"inventory_ordersDlxExchange"` |
| Queue (consumido) | `{fieldName}Queue` (`fieldName = camelCase(queueKey)`) | `inventoryOrderPlacedQueue` |
| DLQ (consumido) | `{fieldName}Dlq` | `inventoryOrderPlacedDlq` |
| Binding (consumido) | `{fieldName}Binding` | `inventoryOrderPlacedBinding` |
| Binding DLQ (consumido) | `{fieldName}DlqBinding` | `inventoryOrderPlacedDlqBinding` |

> El prefijo `{bcCamel}_` en los beans del productor evita colisiones en el contexto Spring
> cuando dos BCs (desplegados en el mismo servicio) consumen del mismo exchange productor.

#### Bloque `broker.dlq` en `published[]` — campos `routingKey` y `queueName`

Opcional. Solo aplica cuando el BC publicador necesita controlar el enrutamiento del DLX de sus consumidores.

```yaml
domainEvents:
  published:
    - name: OrderPlaced
      scope: integration
      channel: orders.order.placed
      broker:
        dlq:
          routingKey: orders.order.placed.dead    # x-dead-letter-routing-key en la queue del consumidor
          queueName: orders-placed-poison         # nombre físico de la DLQ (opcional; default = routingKey)
```

| Campo | Rol | Generado en |
|---|---|---|
| `broker.dlq.routingKey` | Valor de `x-dead-letter-routing-key` en la queue principal y routing-key del `DlqBinding` | `{ConsumerBc}RabbitMQConfig.java` |
| `broker.dlq.queueName` | Nombre físico de la DLQ declarada. Si se omite, defaultea a `dlq.routingKey`. Si ambos se omiten, se usa `{queueName}.dlq` por convención. | `{ConsumerBc}RabbitMQConfig.java` |

> `dlq.routingKey ≠ dlq.queueName` es el caso avanzado: permite que el DLX enrute con una routing-key específica a una queue con un nombre independiente (por ejemplo, una queue de archivo compartida por varios eventos).

---

## 6. Artefactos de infraestructura Kafka generados

Cuando el build se ejecuta con `broker: kafka` (declarado en `system.yaml`), el generador
produce los siguientes artefactos. Ninguno requiere declaración adicional en el `{bc}.yaml`
más allá de `domainEvents.published[]` y `domainEvents.consumed[]`.

> **Diferencia clave respecto a RabbitMQ:** Kafka **no** genera un archivo de configuración
> de topología por BC (`{BcPascal}RabbitMQConfig.java` no tiene equivalente). Los topics se
> declaran en un bloque `topics:` plano dentro del YAML de parámetros y Spring los crea
> automáticamente vía `KafkaAdmin` al arrancar la aplicación.

### 6.1 `parameters/{env}/kafka.yaml` — conexión y topics

**Ruta:** `src/main/resources/parameters/{env}/kafka.yaml`  
**Template:** `templates/base/resources/parameters/{env}/kafka.yaml.ejs`  
**Generado:** una vez por proyecto, en los 4 entornos (`local`, `develop`, `test`, `production`).

El generador re-renderiza este archivo en un segundo pase después de procesar todos los BCs,
inyectando la topología completa de topics derivada de `buildKafkaTopology()`.

#### Diferencias entre entornos

| Entorno | `bootstrap-servers` |
|---|---|
| `local` | `localhost:9092` (hardcoded) |
| `develop` | `${KAFKA_BOOTSTRAP_SERVERS:localhost:9092}` (variable de entorno con fallback) |
| `test` | `${KAFKA_BOOTSTRAP_SERVERS:localhost:9092}` (variable de entorno con fallback) |
| `production` | `${KAFKA_BOOTSTRAP_SERVERS}` (variable de entorno obligatoria, sin fallback) |

#### Contenido generado (entorno `local` como referencia)

```yaml
spring:
  kafka:
    bootstrap-servers: localhost:9092
    consumer:
      group-id: {artifactId}-group
      auto-offset-reset: earliest
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.apache.kafka.common.serialization.StringDeserializer
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
    listener:
      ack-mode: manual_immediate

topics:
  # publicados — clave = {event-kebab}   valor = {bcName}.{event-kebab}
  product-activated: catalog.product-activated

  # consumidos — clave = {bcName}-{event-kebab}  valor = {producerBcName}.{event-kebab}
  inventory-order-placed: orders.order-placed

  # proyecciones persistentes — clave = {bcName}-projection-{projKebab}-{eventKebab}
  catalog-projection-product-summary-product-activated: catalog.product-activated
```

#### Derivación de claves de topics (`buildKafkaTopology`)

| Origen | Clave generada | Valor generado |
|---|---|---|
| `published[]` (scope ≠ `internal`) | `{event-kebab}` | `{bcName}.{event-kebab}` |
| `published[]` con `channel` declarado | `{channel-último-segmento-kebab}` | valor del `channel` |
| `consumed[]` | `{bcName}-{event-kebab}` o `consumed[].topicKey` si está declarado | `{producerBc}.{event-kebab}` (primer segmento de `consumed[].channel`) |
| `projections[]` con `persistent: true` y `source.kind: event` | `{bcName}-projection-{projKebab}-{eventKebab}` | `{sourceBc}.{eventKebab}` |

> `kafka-ui` en el docker-compose generado corre en el puerto **`8090`** del host
> (`8090:8080`) para evitar conflicto con el puerto `8080` del propio servicio Spring Boot.

> Los `@Value("${topics.{topicNameKebab}}")` en el adaptador `KafkaMessageBroker` y los
> `@KafkaListener(topics = "${topics.{topicKey}}")` en los listeners resuelven sus valores
> desde este archivo en tiempo de arranque.

---

### 6.2 `KafkaConfig.java` — beans compartidos

**Ruta:** `src/main/java/{pkg}/shared/infrastructure/configurations/kafkaConfig/KafkaConfig.java`  
**Template:** `templates/messaging/KafkaConfig.java.ejs`  
**Generado:** una vez por proyecto (shared), condición: `config.broker === 'kafka'`.

Declara los beans de infraestructura Kafka compartidos por todos los BCs:

```java
@Configuration
public class KafkaConfig {

    @Bean
    public ProducerFactory<String, Object> kafkaProducerFactory(ObjectMapper objectMapper) { ... }

    @Bean
    public KafkaTemplate<String, Object> kafkaTemplate(ProducerFactory<String, Object> kafkaProducerFactory) { ... }

    @Bean
    public KafkaAdmin kafkaAdmin() { ... }
}
```

| Bean | Tipo | Rol |
|---|---|---|
| `kafkaProducerFactory` | `DefaultKafkaProducerFactory<String, Object>` | Serializa valores con `JsonSerializer` (sin `@class` type info) |
| `kafkaTemplate` | `KafkaTemplate<String, Object>` | Utilizado por todos los `{BcPascal}KafkaMessageBroker` |
| `kafkaAdmin` | `KafkaAdmin` | Crea topics automáticamente al arrancar si `KafkaAdmin.autoCreate=true` |

> Las definiciones de topics (`NewTopic` beans) **no** se declaran aquí. Se derivan del bloque
> `topics:` en `kafka.yaml` — Spring Boot auto-crea los topics si el broker lo permite.

---

### 6.3 `{BcPascal}KafkaMessageBroker.java` — adaptador publicador

**Ruta:** `src/main/java/{pkg}/{bc}/infrastructure/adapters/kafkaMessageBroker/{BcPascal}KafkaMessageBroker.java`  
**Template:** `templates/messaging/KafkaMessageBroker.java.ejs`  
**Generado:** una vez por BC, solo si el BC tiene eventos publicados con `scope ≠ internal`.

Implementa el puerto de salida `MessageBroker` con un método `publish{EventName}()` por cada
evento publicado con `publishToBroker: true`.

```java
@Component("catalogKafkaMessageBroker")
public class CatalogKafkaMessageBroker implements MessageBroker {

    @Value("${topics.product-activated}")
    private String productActivatedTopic;

    private final KafkaTemplate<String, Object> kafkaTemplate;

    // Caso básico — sin partitionKey ni headers:
    @Override
    public void publishProductActivatedIntegrationEvent(ProductActivatedIntegrationEvent event) {
        EventEnvelope<ProductActivatedIntegrationEvent> envelope = EventEnvelope.of(
            productActivatedTopic, event, MDC.get("correlationId")
        );
        kafkaTemplate.send(productActivatedTopic, envelope);
    }

    // Caso con broker.partitionKey: productId — la partition key es el valor del campo:
    @Override
    public void publishOrderPlacedIntegrationEvent(OrderPlacedIntegrationEvent event) {
        String partitionKey = String.valueOf(event.productId());   // derived_from: broker.partitionKey=productId
        kafkaTemplate.send(orderPlacedTopic, partitionKey, envelope);
    }

    // Caso con broker.headers — se emite un ProducerRecord con cabeceras:
    @Override
    public void publishProductUpdatedIntegrationEvent(ProductUpdatedIntegrationEvent event) {
        ProducerRecord<String, Object> record = new ProducerRecord<>(productUpdatedTopic, null, envelope);
        record.headers().add(new RecordHeader("x-source-bc", "catalog".getBytes(StandardCharsets.UTF_8)));
        kafkaTemplate.send(record);
    }
}
```

#### Lógica de publicación según hints de `broker:`

| `broker` declarado | Llamada generada |
|---|---|
| Ninguno | `kafkaTemplate.send(topic, envelope)` |
| Solo `partitionKey` | `kafkaTemplate.send(topic, partitionKey, envelope)` |
| Solo `headers` | `kafkaTemplate.send(ProducerRecord)` con `record.headers().add(...)` |
| `partitionKey` + `headers` | `ProducerRecord` con `key=partitionKey` + headers añadidos |

> `broker.retry` y `broker.dlq` son validados pero **no tienen efecto** en este adaptador
> para Kafka — no se genera ningún `RetryTemplate` ni configuración de DLQ. Están reservados
> para una fase futura del generador.

> **Limitación conocida (GAP-KAFKA-3):** Cuando `system.yaml` declara
> `reliability.outbox: true` junto con `broker: kafka`, el `{BcPascal}DomainEventHandler`
> generado usa `@Value("${exchanges.*}")` y `@Value("${routing-keys.*}")` — namespaces de
> propiedades propios de RabbitMQ que **no existen en `kafka.yaml`**. El `OutboxRelay` Kafka
> usa los fallbacks hardcoded, que apuntan a un exchange inexistente. La combinación
> `outbox + kafka` produce código que compila pero falla al publicar mensajes en runtime.
> Workaround: no usar `outbox: true` con `broker: kafka` hasta que este gap sea subsanado.

---

### 6.4 `{EventName}KafkaListener.java` — adaptador consumidor

**Ruta:** `src/main/java/{pkg}/{bc}/infrastructure/kafkaListener/{EventName}KafkaListener.java`  
**Template:** `templates/messaging/KafkaListener.java.ejs`  
**Generado:** uno por evento consumido que tenga un use case con `trigger.kind: event`.

```java
@Component("catalog.ProductActivatedKafkaListener")
public class ProductActivatedKafkaListener {

    @KafkaListener(topics = "${topics.catalog-product-activated}", groupId = "${spring.kafka.consumer.group-id}")
    public void handle(ConsumerRecord<String, String> record, Acknowledgment acknowledgment) {
        EventEnvelope<Map<String, Object>> event = objectMapper.readValue(
            record.value(), new TypeReference<EventEnvelope<Map<String, Object>>>() {});

        // extracción de campos del payload:
        UUID productId = objectMapper.convertValue(event.data().get("productId"), UUID.class);
        String name    = objectMapper.convertValue(event.data().get("name"),      String.class);

        useCaseMediator.dispatch(new ActivateProductCommand(productId, name));
        acknowledgment.acknowledge();
    }
}
```

#### Clave de topic en el listener

La clave `${topics.{topicKey}}` se resuelve así (en orden de precedencia):

1. `consumed[].topicKey` — si está declarado explícitamente en el YAML.
2. `{bcName}-{event-kebab}` — derivado automáticamente (e.g. `catalog-product-activated`).

#### Idempotencia y sagas (condicional)

| Condición YAML | Código añadido |
|---|---|
| `system.yaml` → `reliability.consumerIdempotency: true` | Inyecta `IdempotencyGuard`; verifica `eventId` antes de despachar |
| El evento participa en una saga declarada en `system.yaml` | Añade `@SagaStep(...)` + propaga `correlationId` vía `CorrelationContext` |

---

### 6.5 Archivos comunes con RabbitMQ

Los siguientes artefactos se generan **de forma idéntica** independientemente del broker
seleccionado (Kafka o RabbitMQ):

| Archivo | Ruta | Template |
|---|---|---|
| `{EventName}Event.java` | `{bc}/domain/events/` | `messaging/DomainEvent.java.ejs` |
| `{EventName}IntegrationEvent.java` | `{bc}/application/events/` | `messaging/IntegrationEvent.java.ejs` |
| `MessageBroker.java` | `{bc}/application/ports/` | `messaging/MessageBroker.java.ejs` |
| `{BcPascal}DomainEventHandler.java` | `{bc}/application/usecases/` | `messaging/DomainEventHandler.java.ejs` |

> `MessageBroker.java` incluye en su Javadoc la frase  
> _"Implementations live in infrastructure/adapters/rabbitmqMessageBroker/."_  
> Esto es un artefacto residual del template. El comentario es cosmético; el bean activo en
> runtime es siempre el que coincide con el broker configurado en `system.yaml`.

---

### Resumen de artefactos Kafka por tipo de elemento YAML

| Elemento en `{bc}.yaml` | Archivo generado | Condición |
|---|---|---|
| `domainEvents.published[]` (scope ≠ `internal`) | `{EventName}Event.java` | Siempre |
| `domainEvents.published[]` (scope ≠ `internal`) | `{EventName}IntegrationEvent.java` | Siempre |
| Al menos un evento publicado con `publishToBroker: true` | `MessageBroker.java` (puerto) | Una vez por BC |
| Al menos un evento publicado con `publishToBroker: true` | `{BcPascal}DomainEventHandler.java` | Una vez por BC |
| Al menos un evento publicado con `publishToBroker: true` | `{BcPascal}KafkaMessageBroker.java` | Una vez por BC |
| `domainEvents.consumed[]` + use case `trigger.kind: event` | `{EventName}KafkaListener.java` | Uno por evento consumido con UC |
| Primer BC procesado (shared) | `KafkaConfig.java` | Una vez por proyecto |
| Todos los BCs procesados (shared) | `parameters/{env}/kafka.yaml` (×4 entornos) | Una vez por proyecto |

