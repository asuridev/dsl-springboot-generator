# Referencia de `{bc}.yaml` — Parte 5: Integrations y domainEvents

---

## Tabla de contenidos

1. [Sección `integrations`](#1-sección-integrations)
   - 1.1 [Outbound HTTP (`integrations.outbound`)](#11-outbound-http-integrationsoutbound)
   - 1.2 [Inbound HTTP (`integrations.inbound`)](#12-inbound-http-integrationsinbound)
2. [Sección `domainEvents`](#2-sección-domainevents)
   - 2.1 [Eventos publicados (`domainEvents.published`)](#21-eventos-publicados-domainevents-published)
   - 2.2 [Payload de eventos](#22-payload-de-eventos)
   - 2.3 [Partición de eventos (partitionKey)](#23-partición-de-eventos-partitionkey)
   - 2.4 [Eventos consumidos (`domainEvents.consumed`)](#24-eventos-consumidos-domainevents-consumed)
   - 2.5 [EventMetadata canónico](#25-eventmetadata-canónico)
3. [Validaciones cruzadas (INT-*)](#3-validaciones-cruzadas-int-)
4. [Ejemplos completos](#4-ejemplos-completos)

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
          partitionKey: true    # clave de partición Kafka; solo un campo por evento; ignorado en RabbitMQ

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
```

#### Propiedades de `published`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | PascalCase | ✅ | Nombre del evento. Genera `{Name}Event.java` (domain event record — con sufijo `Event`) e `{Name}IntegrationEvent.java` (wire format). |
| `scope` | `internal` \| `integration` \| `both` | no | Determina qué capas reciben el evento. `internal`: solo dentro del BC. `integration`: solo hacia el broker. `both`: ambas. **Default: `both`** cuando se omite. |
| `channel` | string | no (recomendado) | Canal del broker. Convención: `{bc}.{kebab-event-name-con-puntos}`. Ej: `catalog.product.activated`. Validación INT-018 compara con AsyncAPI. |
| `payload` | lista | ✅ | Campos del evento. Ver §2.2. |

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

  # Campo oculto — solo válido con allowHiddenLeak: true
  - name: internalCostBasis
    type: Decimal
    source: aggregate
    field: costBasis            # campo marcado hidden: true en el agregado
    allowHiddenLeak: true       # INT-021: autoriza explícitamente exponer el campo
```

#### Propiedades de un campo de payload

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | camelCase | ✅ | Nombre del campo en el record Java del evento. |
| `type` | tipo canónico | ✅ | Tipo Java del campo. |
| `source` | enum | ✅ | De dónde proviene el valor en runtime. Ver tabla siguiente. |
| `field` | camelCase | ✅ si `source: aggregate` | Nombre de la propiedad del agregado. Debe existir en `aggregates[].properties`. |
| `value` | literal | ✅ si `source: constant` | Valor constante a emitir. Si se omite, el generador emite `null /* TODO */`. |
| `partitionKey` | boolean | no | Si `true`, este campo actúa como clave de partición Kafka. Solo un campo por evento puede tenerlo. Ignorado en RabbitMQ. |
| `allowHiddenLeak` | boolean | no | Si `true`, permite exponer en el evento un campo marcado `hidden: true` en el agregado (INT-021). Default: `false`. |

#### Valores de `source`

| Valor | Java generado en el método `raise()` | Cuándo usarlo |
|---|---|---|
| `aggregate` | `this.get{Field}()` | El valor proviene directamente del estado del agregado. |
| `timestamp` | `Instant.now()` | Marca temporal del momento en que ocurre el evento. |
| `auth-context` | ❌ **No permitido** — la build falla con INT-025 | No es un origen válido en el payload de un evento. El agregado es agnóstico a la seguridad. Declarar el campo como `source: param`, añadirlo a `domainMethods[].params`, y resolver `SecurityContext` en el handler. |
| `param` | parámetro adicional en la firma de `raise()` | Un valor que se pasa explícitamente al método. Ej: `reason`, `notes`. Requiere que el parámetro exista en la firma del método del agregado. |
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

### 2.3 Partición de eventos (partitionKey)

El broker de mensajería se selecciona en tiempo de build a través de `system.yaml` — no en el YAML de cada BC. Por eso no existe un bloque `broker:` en `published[]`. La configuración de reintentos y DLQ es por entorno y vive en los archivos de infraestructura (`rabbitmq.yaml` / `kafka.yaml`), no en el diseño del dominio.

La **única** información de publicación que sí pertenece al diseño del evento es la **clave de partición Kafka**: qué campo del payload Kafka debe usar para calcular la partición. Se declara con `partitionKey: true` directamente en el elemento del `payload[]` que debe actuar como clave. Esto garantiza que todos los eventos del mismo agregado (mismo `productId`, mismo `orderId`, etc.) siempre van a la misma partición y por lo tanto mantienen orden.

```yaml
payload:
  - name: productId
    type: Uuid
    source: aggregate
    field: id
    partitionKey: true    # ← Kafka usa este campo para calcular la partición
                          #   garantiza orden de eventos por producto
```

#### Reglas

| Regla | Detalle |
|---|---|
| Un solo campo por evento | Si más de un campo tiene `partitionKey: true`, el generador emite `GEN-ERROR`. |
| Tipos válidos | `Uuid`, `String`, `Integer`, `Long`. Otros tipos producen `GEN-WARN`. |
| Solo Kafka | Si el broker seleccionado en build es RabbitMQ, `partitionKey: true` se ignora silenciosamente. |
| DLQ por convención | El nombre del DLQ se deriva como `{channel}.dlq`. No hay campo `dlq.target` ni bloque `broker.dlq` en `published[]`. |
| Retry de publicación | Configurado en los archivos de entorno — no en el YAML del BC. |

> ⚠️ Si un `{bc}.yaml` contiene un bloque `broker:` en `published[]`, el generador emite `GEN-ERROR: schema obsoleto — el bloque broker ya no existe; usar partitionKey: true en el campo del payload`.

---

### 2.4 Eventos consumidos (`domainEvents.consumed`)

Declara los eventos que este BC recibe del broker y cómo procesa su payload.

```yaml
domainEvents:
  consumed:
    - name: ProductActivated      # nombre del evento (debe coincidir con el publicado)
      sourceBc: catalog           # BC que publica este evento (para validación INT-007)
      payload:                    # subconjunto de campos relevantes para este BC
        - name: productId
          type: Uuid
        - name: sku
          type: String(50)
        - name: price
          type: Money

      retry:
        maxAttempts: 5
        backoff: exponential
        initialMs: 500
        maxMs: 30000

      dlq:
        afterAttempts: 5
        target: inventory.product-activated.dlq
```

#### Propiedades de `consumed`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | PascalCase | ✅ | Nombre del evento. Debe estar declarado en `domainEvents.published[]` del BC `sourceBc` (validación INT-007). |
| `sourceBc` | kebab-case | ✅ | BC que publica este evento. Usado para la validación INT-007 y INT-020. |
| `channel` | string | no | Canal del broker donde se publica el evento (ej: `catalog.product.activated`). Cuando se declara, el generador lo usa para derivar el BC productor en la topología de colas. |
| `payload` | lista | no | Subconjunto de campos del payload que este BC necesita. Validación INT-020: todos los campos declarados aquí deben existir en el `published[].payload[]` del BC productor. Si `payload` se omite, se usa el payload completo del evento publicado. |
| `retry` | objeto | no | Configuración de reintento del consumer. |
| `dlq` | objeto | no | Configuración de DLQ del consumer. Si `target` se omite, el nombre se deriva por convención como `{channel}.dlq`. |

#### Código Java generado

**`ProductActivatedRabbitListener.java`** (o `ProductActivatedKafkaListener.java` según broker):
```java
package com.canastaShop.inventory.infrastructure.rabbitListener;

// derived_from: domainEvents.consumed[name=ProductActivated, sourceBc=catalog]
@Component
public class ProductActivatedRabbitListener {

    private final UseCaseMediator useCaseMediator;
    private final ObjectMapper objectMapper;

    @RabbitListener(queues = "${queues.inventory-product-activated}")
    public void handle(Message message, Channel channel) throws IOException {
        EventEnvelope<Map<String, Object>> event = objectMapper.readValue(
                message.getBody(),
                new TypeReference<EventEnvelope<Map<String, Object>>>() {});

        Map<String, Object> payload = event.payload();
        CreateStockItemCommand command = new CreateStockItemCommand(
            (String) payload.get("productId"),
            (String) payload.get("sku")
        );
        useCaseMediator.send(command);
        channel.basicAck(message.getMessageProperties().getDeliveryTag(), false);
    }
}
```

> **El consumer sabe qué use case activar** a través de la referencia `trigger.kind: event`
> en el use case correspondiente. El generador vincula automáticamente el consumer con
> el handler del use case derivando el `command` del use case cuyo `trigger.consumes`
> coincide con el `name` del evento consumido. No se genera un record separado para
> deserialización: el listener usa `EventEnvelope<Map<String, Object>>` con Jackson.

---

### 2.5 EventMetadata canónico

Cuando la configuración `events.metadata.enabled: true` (default), cada evento publicado
incluye automáticamente un componente `EventMetadata` como primer campo del record.
Este componente es un record canónico compartido por todos los eventos del sistema.

```java
// EventMetadata.java (generado como clase compartida)
public record EventMetadata(
    UUID eventId,           // UUID v4 único por instancia de evento
    String eventType,       // nombre del evento (e.g. "ProductActivated")
    String eventVersion,    // versión del contrato (e.g. "1")
    Instant occurredAt,     // Instant.now() en el momento del raise()
    UUID correlationId,     // ID de correlación de la traza distribuida
    UUID causationId        // ID del command/query que causó el evento
) {
    public static EventMetadata now(String eventType, String version) {
        return new EventMetadata(
            UUID.randomUUID(),
            eventType,
            version,
            Instant.now(),
            MDC.get("correlationId") != null ? UUID.fromString(MDC.get("correlationId")) : null,
            MDC.get("causationId") != null ? UUID.fromString(MDC.get("causationId")) : null
        );
    }
}
```

> **Filtro de campos del payload:** si el `published[].payload[]` declara campos con
> los mismos nombres que los del `EventMetadata` canónico (`eventId`, `eventType`,
> `eventVersion`, `occurredAt`, `correlationId`, `causationId`), el generador emite una
> advertencia de deprecación y filtra esos campos del payload para evitar duplicados.
> La información ya está en `EventMetadata`.

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
| **INT-012** | error | Cada `step.triggeredBy` en una saga debe estar publicado por algún BC. |
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
          partitionKey: true     # clave de partición Kafka; ignorado en RabbitMQ
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
      retry:
        maxAttempts: 5
        backoff: exponential
        initialMs: 500
        maxMs: 60000
      dlq:
        afterAttempts: 5
        target: catalog.category-deactivated.dlq
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

El generador produce el consumer listener que extrae los campos del evento y los
convierte en los parámetros del command:

```java
@Component("inventory.ProductActivatedRabbitListener")
public class ProductActivatedRabbitListener {

    private final UseCaseMediator useCaseMediator;
    private final ObjectMapper objectMapper;

    @RabbitListener(queues = "${queues.inventory-product-activated}")
    public void handle(Message message, Channel channel) throws IOException {
        EventEnvelope<Map<String, Object>> event = objectMapper.readValue(
                message.getBody(),
                new TypeReference<EventEnvelope<Map<String, Object>>>() {});

        Map<String, Object> payload = event.payload();
        CreateStockItemCommand command = new CreateStockItemCommand(
            (String) payload.get("stockItemId")
        );
        useCaseMediator.send(command);
        channel.basicAck(message.getMessageProperties().getDeliveryTag(), false);
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
