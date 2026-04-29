# Nuevas características de integración — Fases 0–5

Este documento describe las extensiones de schema y los artefactos generados introducidos por las **fases 0–5** del plan de remediación de integraciones (`analisis/integrations-remediation-plan.md`). Todas las adiciones son **opcionales** y **retrocompatibles**: un diseño existente que no las declare produce exactamente el mismo código que antes.

Las fases se entregaron en orden:

| Fase | Tema | Entrega |
|---|---|---|
| 0 | Validador cross-YAML + helper `derived_from` | INT-001..INT-007 |
| 1 | Adaptadores ACL para sistemas externos | port/adapter/mapper + `@HttpExchange` |
| 2 | Outbox transaccional + idempotencia de consumidores | tabla `outbox`, `IdempotencyGuard` |
| 3 | Local Read Model (proyecciones persistentes) | JPA + Updater + Flyway |
| 4 | Sagas coreografiadas | `@SagaStep`, `CorrelationContext`, `SagaSteps` |
| 5 | Resiliencia HTTP + autenticación | `@CircuitBreaker`/`@Retry`, OAuth2/api-key |

---

## Fase 0 — Validador cross-YAML

### 1.1 Qué problema resuelve

Antes de la fase 0, el generador asumía que `system.yaml` y los `bc.yaml` estaban consistentes. Una integración HTTP `from: orders → to: catalog` podía referenciar un BC inexistente y el código se generaba de todos modos, fallando sólo en runtime.

### 1.2 Reglas de validación

El módulo `src/utils/integration-validator.js` ejecuta el conjunto **INT-001..INT-015** sobre todos los YAML cargados. Cada diagnóstico es:

```js
{ code: 'INT-003', level: 'error' | 'warn', message: '...', location: 'system.yaml#/integrations[1]' }
```

| Código | Verifica |
|---|---|
| INT-001 | Cada evento en `domainEvents.consumed` está publicado por algún BC. |
| INT-002 | Cada evento en `integrations[].events.published` aparece en el `bc.yaml` correspondiente. |
| INT-003 | Una integración `customer-supplier` HTTP requiere `arch/{to}/{to}-internal-api.yaml`. |
| INT-004 | Toda integración con un sistema externo referencia un nombre presente en `system.externalSystems`. |
| INT-005 | El `channel` declarado en `system.yaml` coincide con el canal del `bc.yaml` (warn). |
| INT-006 | Una entrada `integrations.outbound` en un `bc.yaml` referencia un BC o sistema externo que existe. |
| INT-007 | Todo consumidor de evento aparece como destino en `system.integrations`. |
| INT-008..INT-009 | Operaciones y `auth.key` declaradas para sistemas externos. |
| INT-010..INT-011 | Proyecciones persistentes — fuente y `consumed[]`. |
| INT-012..INT-014 | Sagas — `triggeredBy`, `onSuccess`, `onFailure`, compensación. |
| INT-015 | Una integración con `auth.type: oauth2-cc` declara `tokenEndpoint` y `credentialKey`. |

### 1.3 CLI

```bash
# Aborta la generación si hay un solo error (default).
dsl-springboot build --strict

# Sólo imprime los diagnósticos sin abortar.
dsl-springboot build --no-strict
```

### 1.4 Helper `derived_from`

`src/utils/derived-from.js` expone a las plantillas EJS un helper para añadir trazabilidad explícita entre el código generado y el YAML que lo originó:

```ejs
<%- derivedFrom('system.yaml#/integrations[from=orders,to=catalog]/resilience') %>
```

Produce:

```java
// derived_from: system.yaml#/integrations[from=orders,to=catalog]/resilience
```

---

## Fase 1 — Sistemas externos como ACL

### 2.1 Qué problema resuelve

Antes, un BC que llamaba a un payment-gateway debía escribir manualmente el cliente HTTP, los DTOs y el mapper. Ahora basta con declarar la operación en `system.yaml` y referenciarla desde el `bc.yaml`.

### 2.2 Schema añadido

```yaml
# system.yaml
externalSystems:
  - name: payment-gateway
    transport: http
    baseUrl: https://gw.example.com
    auth:
      type: api-key
      key: PAYMENT_GATEWAY_API_KEY        # variable de entorno SCREAMING_SNAKE
      header: X-Api-Key
    operations:
      - name: chargeCard
        method: POST
        path: /v1/charges
        request: ChargeRequest
        response: ChargeResponse
        errors: [InsufficientFunds, CardDeclined]
```

```yaml
# arch/payments/payments.yaml
integrations:
  outbound:
    - name: payment-gateway
      type: externalSystem
      operations:
        - name: chargeCard
```

### 2.3 Artefactos generados

Para cada sistema externo referenciado:

```
src/main/java/{pkg}/payments/
├── application/
│   └── ports/PaymentGatewayClientPort.java        ← interfaz de dominio
└── infrastructure/adapters/payment-gateway/
    ├── PaymentGatewayRestClient.java              ← @HttpExchange (Spring 6)
    ├── PaymentGatewayRestAdapter.java             ← implementa el port
    ├── PaymentGatewayAclMapper.java               ← DTO ↔ dominio
    └── PaymentGatewayRestConfig.java              ← interceptor de auth
```

### 2.4 Ejemplo de cliente generado

```java
@HttpExchange(url = "${payment-gateway.base-url}")
public interface PaymentGatewayRestClient {

    @PostExchange("/v1/charges")
    ChargeResponseDto chargeCard(@RequestBody ChargeRequestDto request);
}
```

El `RestConfig` añade el header `X-Api-Key` leyendo `${payment-gateway.api-key}` desde `application-{env}.yaml`.

---

## Fase 2 — Outbox + idempotencia

### 3.1 Qué problema resuelve

El patrón `@TransactionalEventListener(AFTER_COMMIT)` no es atómico: si el broker está caído entre el commit y la publicación, el evento se pierde. La fase 2 añade un **outbox** opt-in y un guard contra **redelivery duplicada**.

### 3.2 Schema añadido

```yaml
# system.yaml
infrastructure:
  reliability:
    outbox: true               # default false
    consumerIdempotency: true  # default false
```

### 3.3 Artefactos generados (outbox=true)

```
shared/infrastructure/outbox/
├── OutboxEventJpa.java
├── OutboxJpaRepository.java
├── OutboxPublisher.java       ← @Scheduled poller
└── V{n}__outbox.sql           ← Flyway migration
```

El `DomainEventHandler` cambia su comportamiento:

```java
// Antes (sin outbox):
@TransactionalEventListener(phase = AFTER_COMMIT)
public void onProductActivated(ProductActivatedEvent ev) {
    messageBroker.publishProductActivatedIntegrationEvent(...);
}

// Después (outbox=true):
@EventListener
@Transactional(propagation = MANDATORY)  // mismo tx que el aggregate
public void onProductActivated(ProductActivatedEvent ev) {
    outboxRepo.save(new OutboxEventJpa(ev.eventId(), payload, status=PENDING));
}
```

`OutboxPublisher` corre cada N segundos, lee `PENDING`, llama al broker, marca `PUBLISHED` o incrementa `attempts`.

### 3.4 Idempotencia (consumerIdempotency=true)

```java
@RabbitListener(...)
public void on(IntegrationEventEnvelope env) {
    idempotencyGuard.runOnce(env.eventId(), "OrdersConsumer", () -> {
        // dispatch a use-case
    });
}
```

La tabla `processed_event` (migración Flyway) almacena `(event_id, handler_id)` con UNIQUE. Una segunda entrega corta el flujo sin re-ejecutar el handler.

---

## Fase 3 — Local Read Model (proyecciones persistentes)

### 4.1 Qué problema resuelve

Una proyección **transitoria** (la única soportada antes) sólo expone una vista derivada del modelo de escritura. Para escenarios cross-BC (ej. orders necesita el snapshot de la dirección del customer) hace falta un **Local Read Model** materializado.

### 4.2 Schema añadido en `bc.yaml`

```yaml
projections:
  - name: CustomerAddressSnapshot
    persistent: true                       # NUEVO
    source:
      kind: event
      event: CustomerAddressUpdated
      from: customers                      # BC origen
    keyBy: customerId
    upsertStrategy: lastWriteWins          # | versionGuarded
    properties:
      - { name: customerId, type: UUID }
      - { name: line1,      type: String }
      - { name: city,       type: String }
```

### 4.3 Artefactos generados

Cuando `persistent: true`:

```
{bc}/infrastructure/persistence/projections/
├── CustomerAddressSnapshotJpa.java
├── CustomerAddressSnapshotJpaRepository.java
└── V{n}__customer_address_snapshot.sql
{bc}/application/projections/
└── CustomerAddressSnapshotUpdater.java     ← consume CustomerAddressUpdated
```

El updater hace upsert por `customerId`. Con `versionGuarded` se ignora un evento cuya `version` sea menor a la persistida (evita reordenamientos del broker).

### 4.4 Validaciones

- INT-010: el evento `source.event` debe estar publicado por `source.from`.
- INT-011: si el evento no está en `domainEvents.consumed[]` del BC actual, el validador exige añadirlo (no lo infiere).

---

## Fase 4 — Sagas coreografiadas

### 5.1 Qué problema resuelve

Una saga distribuida (ej. checkout: stock → payment → confirmation) atraviesa múltiples BCs. Sin asistencia, el `correlationId` se pierde entre saltos y no hay forma de reconstruir el flujo en logs/tracing.

### 5.2 Schema añadido

```yaml
# system.yaml
sagas:
  - name: CheckoutSaga
    style: choreography                     # NUEVO (orchestrated → fase 8)
    trigger: { bc: orders, event: OrderPlaced }
    steps:
      - order: 1
        bc: inventory
        triggeredBy: OrderPlaced
        onSuccess: StockReserved
        onFailure: StockReservationFailed
        compensation: StockReleased
      - order: 2
        bc: payments
        triggeredBy: StockReserved
        onSuccess: PaymentApproved
        onFailure: PaymentFailed
```

### 5.3 Artefactos generados

```
shared/domain/annotations/SagaStep.java                  ← @interface (saga, order, event, role)
shared/infrastructure/correlation/CorrelationContext.java← ThreadLocal + MDC
shared/application/sagas/CheckoutSagaSteps.java          ← constantes (NAME, STEP_1_*…)
```

### 5.4 Anotaciones inyectadas en handlers existentes

Sólo donde el evento aparece en algún paso de saga:

```java
@TransactionalEventListener(phase = AFTER_COMMIT)
@SagaStep(saga = "CheckoutSaga", order = 0,
          event = "OrderPlaced", role = SagaStep.Role.TRIGGER)
public void onOrderPlaced(OrderPlacedEvent ev) { ... }
```

### 5.5 Propagación de `correlationId`

`RabbitListener` y `KafkaListener` invocan `CorrelationContext.set(env.correlationId())` al recibir un mensaje y `clear()` en `finally`. El `DomainEventHandler` lee `MDC.get("correlationId")` para asignarlo al evento de integración saliente, garantizando que **todos los hops de la saga comparten el mismo correlationId**.

---

## Fase 5 — Resiliencia HTTP + autenticación

### 6.1 Qué problema resuelve

Antes, un cliente Feign generado no tenía timeouts, retries, circuit breaker ni soporte de autenticación más allá de la convención manual. La fase 5 añade declaración de **resiliencia** y **auth** desde el YAML, con resolución automática de templates Resilience4j y de interceptores Feign.

### 6.2 Schema añadido

Los dos bloques (`resilience` y `auth`) son aceptados en tres ubicaciones, con precedencia **bc.yaml outbound > system.yaml**:

```yaml
# system.yaml — integración BC↔BC
integrations:
  - from: orders
    to: catalog
    pattern: customer-supplier
    channel: http
    resilience:
      timeoutMs: 5000
      connectTimeoutMs: 2000
      retries: { maxAttempts: 3, waitDurationMs: 500 }
      circuitBreaker: { failureRateThreshold: 50 }
    auth:
      type: api-key
      valueProperty: integration.catalog.api-key
      header: X-Api-Key
```

```yaml
# system.yaml — sistema externo con OAuth2 client-credentials
externalSystems:
  - name: payment-gateway
    auth:
      type: oauth2-cc
      tokenEndpoint: https://idp.example.com/oauth2/token
      credentialKey: payment-gateway       # registrationId en spring-security
```

```yaml
# arch/{bc}.yaml — override por BC
integrations:
  outbound:
    - name: catalog
      protocol: http
      type: bc
      resilience: { timeoutMs: 8000 }      # override del valor en system.yaml
      auth: { type: bearer, valueProperty: integration.catalog.bearer-token }
```

### 6.3 Tipos de auth soportados

| `auth.type` | Cómo se inyecta | Configuración necesaria |
|---|---|---|
| `none` (o ausente) | Sin interceptor | — |
| `api-key` | `RequestInterceptor` añade header `valueProperty` | `valueProperty`, `header` (default `X-Api-Key`) |
| `bearer` | `Authorization: Bearer <token>` | `valueProperty` |
| `oauth2-cc` | Spring `OAuth2AuthorizedClientManager` resuelve y refresca tokens | `tokenEndpoint`, `credentialKey` |
| `mTLS` | (placeholder; configuración externa) | — |

### 6.4 Artefactos generados — caso `api-key`

`OrdersFeignConfig.java` (en el BC `catalog`, target `orders`):

```java
public class OrdersFeignConfig {

    @Value("${integration.orders.api-key:}")
    private String apiKey;

    @Bean
    public RequestInterceptor ordersAuthInterceptor() {
        return tpl -> tpl.header("X-Api-Key", apiKey);
    }

    @Bean
    public Request.Options feignOptions() {
        return new Request.Options(2000L, MILLISECONDS, 5000L, MILLISECONDS, true);
    }
}
```

### 6.5 Artefactos generados — caso `oauth2-cc`

`shared/infrastructure/auth/OAuth2ClientCredentialsSupport.java` se emite **una sola vez** por proyecto (cuando alguna integración usa `oauth2-cc`):

```java
@Configuration
public class OAuth2ClientCredentialsSupport {

    private final OAuth2AuthorizedClientManager authorizedClientManager;

    public RequestInterceptor buildInterceptor(String registrationId) {
        return template -> {
            OAuth2AuthorizedClient client = authorizedClientManager.authorize(
                OAuth2AuthorizeRequest.withClientRegistrationId(registrationId)
                    .principal("system").build());
            template.header("Authorization", "Bearer " + client.getAccessToken().getTokenValue());
        };
    }
}
```

El config del adaptador **inyecta** ese helper:

```java
public class OrdersFeignConfig {

    private final OAuth2ClientCredentialsSupport oauth2Support;

    public OrdersFeignConfig(OAuth2ClientCredentialsSupport oauth2Support) {
        this.oauth2Support = oauth2Support;
    }

    @Bean
    public RequestInterceptor ordersAuthInterceptor() {
        return oauth2Support.buildInterceptor("orders-client");   // ← credentialKey
    }
}
```

### 6.6 Artefactos generados — resiliencia

`OrdersFeignAdapter.java`:

```java
@Override
@CircuitBreaker(name = "orders", fallbackMethod = "getOrderTotalFallback")
@Retry(name = "orders")
public OrderTotal getOrderTotal(String orderId) {
    return aclMapper.toOrderTotal(feignClient.getOrderTotal(orderId));
}

/** derived_from: resilience.fallback */
@SuppressWarnings("unused")
private OrderTotal getOrderTotalFallback(String orderId, Throwable cause) {
    // TODO: implement fallback for getOrderTotal
    throw new UnsupportedOperationException(
        "Fallback for getOrderTotal not implemented yet", cause);
}
```

> El método de fallback se genera **siempre** que `circuitBreaker` esté declarado. El cuerpo lleva `// TODO` — la lógica concreta (cache stale, valor por defecto, etc.) la añade el desarrollador en la fase 3 del pipeline DSL.

### 6.7 Configuración Resilience4j

Cuando alguna integración declara `resilience`, el generador emite por entorno:

```
src/main/resources/parameters/{local,develop,test,production}/resilience.yaml
```

con bloques `default` para `circuitbreaker` y `retry`. La anotación `@CircuitBreaker(name = "orders")` resuelve a `default` salvo que el desarrollador añada un override:

```yaml
resilience4j:
  circuitbreaker:
    instances:
      orders:                                 # nombre del target
        baseConfig: default
        slidingWindowSize: 50
```

### 6.8 Dependencias gradle (condicionales)

`build.gradle` añade automáticamente:

```gradle
// si hasAnyResilience(...) === true
implementation 'org.springframework.cloud:spring-cloud-starter-circuitbreaker-resilience4j'
implementation 'io.github.resilience4j:resilience4j-spring-boot3'

// si hasAnyOAuth2Cc(...) === true
implementation 'org.springframework.boot:spring-boot-starter-oauth2-client'
```

Sin declaraciones de resiliencia/oauth, el `build.gradle` queda igual que antes.

---

## Casos de uso de referencia

### Caso A — BC interno con resiliencia y api-key

```yaml
# system.yaml
integrations:
  - from: orders
    to: catalog
    pattern: customer-supplier
    channel: http
    resilience:
      timeoutMs: 3000
      retries: { maxAttempts: 3 }
      circuitBreaker: {}
    auth:
      type: api-key
      valueProperty: integration.catalog.api-key
```

**Resultado:** `CatalogFeignAdapter` con `@CircuitBreaker(name="catalog")` + `@Retry(name="catalog")` + fallback; `CatalogFeignConfig` con `@Value("${integration.catalog.api-key:}")` y `RequestInterceptor`. `parameters/local/resilience.yaml` emitido.

### Caso B — Sistema externo con OAuth2 client-credentials

```yaml
# system.yaml
externalSystems:
  - name: payment-gateway
    transport: http
    baseUrl: https://gw.example.com
    auth:
      type: oauth2-cc
      tokenEndpoint: https://idp.example.com/oauth2/token
      credentialKey: payment-gateway
    operations:
      - { name: chargeCard, method: POST, path: /v1/charges, request: ChargeRequest, response: ChargeResponse }

# system.yaml — credenciales en application-{env}.yaml
spring:
  security:
    oauth2:
      client:
        registration:
          payment-gateway:
            client-id:     ${PAYMENT_GW_CLIENT_ID}
            client-secret: ${PAYMENT_GW_CLIENT_SECRET}
            authorization-grant-type: client_credentials
        provider:
          payment-gateway:
            token-uri: https://idp.example.com/oauth2/token
```

**Resultado:** se emite `OAuth2ClientCredentialsSupport.java`; `PaymentGatewayRestConfig` lo inyecta y registra el interceptor con `buildInterceptor("payment-gateway")`. La dependencia `spring-boot-starter-oauth2-client` se añade al `build.gradle`.

### Caso C — Saga con outbox + idempotencia

```yaml
# system.yaml
infrastructure:
  reliability: { outbox: true, consumerIdempotency: true }

sagas:
  - name: CheckoutSaga
    style: choreography
    trigger: { bc: orders, event: OrderPlaced }
    steps:
      - { order: 1, bc: inventory, triggeredBy: OrderPlaced,    onSuccess: StockReserved,   onFailure: StockReservationFailed, compensation: StockReleased }
      - { order: 2, bc: payments,  triggeredBy: StockReserved,  onSuccess: PaymentApproved, onFailure: PaymentFailed }
      - { order: 3, bc: orders,    triggeredBy: PaymentApproved, onSuccess: OrderConfirmed,  onFailure: OrderCancelled }
```

**Resultado:** outbox table + `OutboxPublisher`; cada listener envuelve dispatch en `IdempotencyGuard.runOnce(...)`; `@SagaStep` decora los handlers de `OrderPlaced`, `StockReserved`, `PaymentApproved`; `CorrelationContext` propaga el `correlationId` de `OrderPlaced` a través de los 3 hops.

### Caso D — Local Read Model cross-BC

```yaml
# arch/orders/orders.yaml
domainEvents:
  consumed:
    - CustomerAddressUpdated

projections:
  - name: CustomerAddressSnapshot
    persistent: true
    source: { kind: event, event: CustomerAddressUpdated, from: customers }
    keyBy: customerId
    upsertStrategy: versionGuarded
    properties:
      - { name: customerId, type: UUID }
      - { name: line1,      type: String }
      - { name: city,       type: String }
      - { name: version,    type: Long }
```

**Resultado:** tabla `customer_address_snapshot` con migración Flyway; `CustomerAddressSnapshotUpdater` consume el evento y hace upsert; las queries del BC `orders` pueden leer el snapshot sin llamada HTTP a `customers`.

---

## Tabla de compatibilidad

Todos los campos descritos son **opcionales**. Un proyecto que no declare ninguno produce el mismo código que antes de las fases 0–5. Esto permite:

- Migrar BC por BC sin romper otros.
- Activar resiliencia o auth sólo en integraciones críticas.
- Mantener el modo "scaffold puro" para proyectos exploratorios.

| Característica | Activador YAML | Default | Backward-compat |
|---|---|---|---|
| Validador estricto | flag CLI `--strict` | `true` | `--no-strict` para preservar |
| Sistemas externos como ACL | `system.externalSystems[].operations` | sin operations → no genera | ✅ |
| Outbox | `infrastructure.reliability.outbox: true` | `false` | ✅ |
| Idempotencia consumidor | `infrastructure.reliability.consumerIdempotency: true` | `false` | ✅ |
| Proyecciones persistentes | `projections[].persistent: true` | `false` | ✅ |
| Sagas coreografiadas | `system.sagas[].style: choreography` | sin sagas → no genera | ✅ |
| Resiliencia HTTP | `*.resilience` | sin bloque → no genera | ✅ |
| Auth HTTP | `*.auth.type: api-key \| bearer \| oauth2-cc` | `none` | ✅ |
