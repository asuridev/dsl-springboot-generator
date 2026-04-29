# Nuevas características de `domainEvents` — Fases 0–4

Este documento describe las extensiones de schema y los artefactos generados introducidos por las **fases 0–4** del plan de remediación de `domainEvents` (`/memories/session/plan.md`, `analisis/domainEvents-analisi.md`). Todas las adiciones son **opcionales** y **retrocompatibles**: un `bc.yaml` existente que no las declare produce código equivalente al anterior (con la única excepción de la metadata canónica de Fase 1, que ahora se inyecta por defecto y emite una advertencia si el humano declaró `occurredAt` manualmente).

| Fase | Tema | Schema añadido |
|---|---|---|
| 0 | Quick wins (channel honor, TODO claros, derived_from, descriptions) | — (sin schema nuevo) |
| 1 | Identidad y metadata canónica | `published[].version` |
| 2 | Validación cross-YAML AsyncAPI | — (validador, sin schema) |
| 3 | Mapeo explícito de payload | `payload[].source`, `field`, `param`, `value`, `claim`, `derivedFrom`, `expression` |
| 4 | Scope y broker hints | `published[].scope`, `published[].broker.{partitionKey,headers,retry,dlq}`, `consumed[].{retry,dlq}` |

Las cinco fases han sido verificadas extremo-a-extremo sobre `test-dsl/` con compilación limpia.

---

## Fase 0 — Quick wins

### 0.1 Honor a `published[].channel`

Antes: el routing-key se derivaba siempre del kebab-case del nombre del evento (`product-activated` → `product.activated`).
Ahora: si `bc.yaml` declara `channel`, ese valor se usa tal cual en `parameters/{env}/rabbitmq.yaml`.

```yaml
domainEvents:
  published:
    - name: ProductActivated
      channel: catalog.product.activated     # ← se respeta literal
```

Genera:

```yaml
# parameters/local/rabbitmq.yaml
routing-keys:
  product-activated: catalog.product.activated
```

### 0.2 TODO explícitos en `raise()`

Cuando el aggregate no puede resolver un campo del payload, antes se emitía `null` silenciosamente. Ahora:

```java
raise(new ProductActivatedEvent(
    EventMetadata.now("ProductActivated", 1, "catalog"),
    this.getId(),
    null /* TODO domainEvent(ProductActivated, externalRef): mapping not resolved — declare explicit source: */
));
```

Y la build emite un `WARN` por consola con el evento + campo afectado.

### 0.3 Trazabilidad `derived_from`

Cada `raise()` y cada handler en `{Bc}DomainEventHandler` lleva un comentario:

```java
// derived_from: domainEvents.published.ProductActivated
raise(new ProductActivatedEvent(...));
```

### 0.4 `description` propagada a Javadoc

`published[].description` y `payload[].description` se inyectan en el Javadoc de `{Name}Event` y `{Name}IntegrationEvent`. Si `dsl-springboot.json` declara `openApiAnnotations: true`, también se emiten `@Schema(description = "...")` por campo en el integration event.

---

## Fase 1 — Identidad y metadata canónica

### 1.1 Qué problema resuelve

Antes, cada evento exigía que el humano declarara manualmente `occurredAt` (y opcionalmente `eventId`/`correlationId`). El generador no garantizaba presencia ni unicidad de identidad por evento.

### 1.2 Schema añadido

Una sola clave opcional por evento publicado:

```yaml
domainEvents:
  published:
    - name: ProductActivated
      version: 1                # default 1 — usado en EventMetadata.now(...)
```

### 1.3 Cómo se usa

**No declares** los campos `eventId`, `eventType`, `eventVersion`, `occurredAt`, `correlationId`, `causationId` en `payload[]`. El generador los inyecta como un componente único:

```yaml
# ✅ Correcto
domainEvents:
  published:
    - name: ProductActivated
      payload:
        - { name: productId, type: Uuid }
        - { name: name,      type: String(200) }

# ⚠️ Aceptado pero genera WARN de deprecación
domainEvents:
  published:
    - name: ProductActivated
      payload:
        - { name: productId,  type: Uuid }
        - { name: occurredAt, type: DateTime }   # ← se filtra y se avisa
```

### 1.4 Artefactos generados

Un record canónico nuevo en `shared/domain/`:

```java
public record EventMetadata(
    UUID eventId,
    String eventType,
    int eventVersion,
    Instant occurredAt,
    String sourceBc,
    String correlationId,
    String causationId
) {
    public static EventMetadata now(String eventType, int version, String sourceBc) {
        return new EventMetadata(UUID.randomUUID(), eventType, version, Instant.now(),
                                 sourceBc, MDC.get("correlationId"), MDC.get("causationId"));
    }
}
```

Cada evento de dominio lo lleva como **primer** componente del record:

```java
public record ProductActivatedEvent(
    EventMetadata metadata,
    UUID productId,
    String name,
    UUID categoryId,
    Money price,
    String sku
) implements DomainEvent {}
```

Y el aggregate lo poblado automáticamente:

```java
raise(new ProductActivatedEvent(
    EventMetadata.now("ProductActivated", 1, "catalog"),
    this.getId(),
    this.getName(),
    this.getCategoryId(),
    this.getPrice(),
    this.getSku()
));
```

`EventEnvelope` y los listeners consumidores leen `eventId` desde `metadata` (no desde el envelope), cerrando la idempotencia.

---

## Fase 2 — Validación cross-YAML AsyncAPI

### 2.1 Qué problema resuelve

Hasta ahora la coherencia entre `bc.yaml` y `bc-async-api.yaml` no se verificaba. Era posible publicar un evento con un campo que el contrato AsyncAPI no declaraba (drift silencioso) o exponer un campo `hidden:true` del aggregate.

### 2.2 Reglas añadidas

| Código | Nivel | Verifica |
|---|---|---|
| INT-016 | error | Cada mensaje en AsyncAPI aparece en `published[]` o `consumed[]` del BC. |
| INT-017 | error | Cada `published[]` aparece en AsyncAPI. |
| INT-018 | warn | El `channel` declarado en `bc.yaml` coincide con el address en AsyncAPI. |
| INT-019 | error/warn | Cada campo de `payload[]` aparece en el schema AsyncAPI con tipo compatible. |
| INT-020 | error | Cada campo de un evento `consumed[]` está en el `published[]` del BC productor. |
| INT-021 | error | Un campo del payload no expone un atributo del aggregate marcado `hidden:true` (salvo `allowHiddenLeak: true` explícito). |

Los campos canónicos de `EventMetadata` (`eventId`, `eventType`, `eventVersion`, `occurredAt`, `correlationId`, `causationId`) se ignoran automáticamente — no se requiere declararlos en AsyncAPI.

### 2.3 Cómo se usa

No requiere acción del humano: las reglas se ejecutan en cada `dsl-springboot build`. Para marcar una excepción intencional al INT-021:

```yaml
domainEvents:
  published:
    - name: AccountAuditExported
      allowHiddenLeak: true       # ← decisión consciente: el evento debe llevar el campo hidden
      payload:
        - { name: accountId, type: Uuid }
        - { name: ssn,       type: String(11) }   # marcado hidden:true en el aggregate
```

---

## Fase 3 — Mapeo explícito de payload

### 3.1 Qué problema resuelve

Antes, el generador adivinaba cómo poblar cada campo del payload mediante heurística (¿se llama igual a una propiedad del aggregate? ¿es un parámetro del método? ¿es un timestamp?). La heurística fallaba ante ambigüedades (`actorId`, `idempotencyKey`, `tenantId`, derivaciones, constantes).

### 3.2 Schema añadido — `payload[].source`

Cada campo del payload puede declarar explícitamente de dónde sale su valor:

| `source` | Atributos extra | Java emitido en `raise()` |
|---|---|---|
| `aggregate` | `field: <prop>` (opcional, default = `name`) | `this.get<Field>()` o `this.getId()` si `field: id` |
| `param` | `param: <name>` (opcional, default = `name`) | identificador del parámetro del método |
| `timestamp` | — | `Instant.now()` |
| `constant` | `value: <literal>` | literal Java (`"..."`, número o booleano) |
| `auth-context` | `claim: <name>` | `null` + TODO indicando resolución en el handler |
| `derived` | `derivedFrom: <ref>` o `expression: <code>` | `null` + TODO con la referencia |

Cuando el humano **no** declara `source`, sigue activa la heurística histórica (compatibilidad).

### 3.3 Casos de uso

#### Caso A — desambiguar id del aggregate

El payload llama al campo `productId` pero el aggregate lo llama `id`:

```yaml
- name: ProductActivated
  payload:
    - name: productId
      type: Uuid
      source: aggregate
      field: id          # ← apunta a Product.id
```

Genera:

```java
raise(new ProductActivatedEvent(metadata, this.getId(), ...));
```

#### Caso B — constante de tipo motivo

```yaml
- name: ProductActivated
  payload:
    - name: activationReason
      type: String(50)
      source: constant
      value: MANUAL_ACTIVATION
```

Genera:

```java
raise(new ProductActivatedEvent(metadata, ..., "MANUAL_ACTIVATION"));
```

#### Caso C — actor desde JWT (auth-context)

```yaml
- name: ProductActivated
  payload:
    - name: actorId
      type: Uuid
      source: auth-context
      claim: sub
```

Genera:

```java
raise(new ProductActivatedEvent(metadata, ...,
    null /* TODO domainEvent(ProductActivated, actorId): source=auth-context claim="sub" — populate from SecurityContext in the application handler, not in the aggregate */));
```

> El aggregate **nunca** debe leer `SecurityContext` — rompe la pureza del dominio. La resolución se hace en el `{UseCase}CommandHandler` antes de invocar el método del aggregate, por ejemplo:
>
> ```java
> UUID actorId = SecurityContextUtil.currentUserId();
> product.activate(actorId);
> ```
>
> y el método del aggregate recibe `actorId` como parámetro y lo pasa al `raise()` con `source: param`.

#### Caso D — parámetro del método

```yaml
- name: ProductDiscontinued
  payload:
    - name: productId
      type: Uuid
      source: aggregate
      field: id
    - name: reason
      type: String(200)
      source: param
      param: discontinueReason   # nombre del parámetro en discontinue(reason: String)
```

Genera:

```java
raise(new ProductDiscontinuedEvent(metadata, this.getId(), discontinueReason));
```

#### Caso E — derivado

```yaml
- name: OrderTotalRecalculated
  payload:
    - name: total
      type: Money
      source: derived
      derivedFrom: sum(items[].subtotal)
```

Genera un TODO con la referencia explícita:

```java
raise(new OrderTotalRecalculatedEvent(metadata,
    null /* TODO domainEvent(OrderTotalRecalculated, total): source=derived derivedFrom="sum(items[].subtotal)" — implementar en el método del aggregate */));
```

---

## Fase 4 — Scope y broker hints

### 4.1 Qué problema resuelve

Antes, todo evento publicado generaba simultáneamente: bus interno, integration event, port `MessageBroker`, adaptador broker, exchange, queue, binding y DLQ. Esto:
- Forzaba a publicar al broker eventos que sólo eran de uso interno (proyecciones in-process, sagas locales).
- No permitía configurar `partitionKey`, headers, retries, ni TTL/DLQ por evento.

### 4.2 Schema añadido

```yaml
domainEvents:
  published:
    - name: ProductActivated
      scope: integration            # internal | integration | both — default both
      broker:
        partitionKey: productId     # nombre de un campo en payload (Kafka)
        headers:
          tenantId: "${ctx.tenantId}"
          schemaVersion: "1"
        retry:
          maxAttempts: 5            # → x-delivery-limit
          backoff: exponential      # fixed | exponential
          initialMs: 60000          # → x-message-ttl
          maxMs: 300000             # reservado
        dlq:
          afterAttempts: 3
          target: catalog.product.activated.lost
  consumed:
    - name: StockItemReserved
      retry:                        # mismos campos que broker.retry
        maxAttempts: 10
      dlq:
        target: orders.stock-reserved.lost
```

### 4.3 `scope` — qué se genera

| Valor | DomainEvent record | IntegrationEvent | MessageBroker port | Broker adapter | DomainEventHandler bridge | Topología (exchange/queue/topic) |
|---|---|---|---|---|---|---|
| `internal` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `integration` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `both` (default) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

> El record `DomainEvent` siempre se genera porque el aggregate lo emite por bus interno (Spring `ApplicationEventPublisher`) — incluso para `scope: integration` cuando otros componentes dentro del BC quieran reaccionar antes del commit.

### 4.4 Casos de uso

#### Caso A — evento puramente interno (proyección in-process)

```yaml
- name: ProductPriceRecalculated
  scope: internal
  payload:
    - { name: productId, type: Uuid, source: aggregate, field: id }
    - { name: newPrice,  type: Money, source: aggregate, field: price }
```

Resultado: sólo se genera `ProductPriceRecalculatedEvent.java`. Un `@EventListener` interno (escrito a mano por el equipo) puede consumirlo para invalidar caché o actualizar una proyección sin tocar el broker.

#### Caso B — partitionKey para preservar orden por aggregate (Kafka)

```yaml
- name: OrderItemAdded
  broker:
    partitionKey: orderId          # todos los eventos de la misma orden van a la misma partición
  payload:
    - { name: orderId,    type: Uuid, source: aggregate, field: id }
    - { name: productId,  type: Uuid, source: param }
    - { name: quantity,   type: Integer, source: param }
```

Genera:

```java
String partitionKey = String.valueOf(event.orderId());
kafkaTemplate.send(orderItemAddedTopic, partitionKey, envelope);
```

#### Caso C — headers estáticos / templates

```yaml
- name: ProductActivated
  broker:
    headers:
      tenantId: "${ctx.tenantId}"
      schemaVersion: "1"
```

RabbitMQ:

```java
rabbitTemplate.convertAndSend(exchange, routingKey, envelope, message -> {
    message.getMessageProperties().setHeader("tenantId", "${ctx.tenantId}");
    message.getMessageProperties().setHeader("schemaVersion", "1");
    return message;
});
```

Kafka:

```java
ProducerRecord<String, Object> record = new ProducerRecord<>(topic, partitionKey, envelope);
record.headers().add(new RecordHeader("tenantId", "${ctx.tenantId}".getBytes(UTF_8)));
record.headers().add(new RecordHeader("schemaVersion", "1".getBytes(UTF_8)));
kafkaTemplate.send(record);
```

> **Resolución en runtime**: los valores con `${ctx.xxx}` deben ser interpolados en runtime por un interceptor del equipo (no por el generador) leyendo `MDC` o un `RequestContext`. El generador sólo emite el literal.

#### Caso D — TTL + delivery limit + DLQ con nombre custom

```yaml
- name: ProductActivated
  broker:
    retry:
      maxAttempts: 5
      initialMs: 60000             # 60 s antes de reintentar
    dlq:
      target: catalog.product.activated.lost
```

Genera, en `CatalogRabbitMQConfig.java`:

```java
@Bean
public Queue productActivatedQueue() {
    return QueueBuilder.durable(productActivatedQueueName)
            .withArgument("x-dead-letter-exchange", catalogExchangeName + ".dlx")
            .withArgument("x-dead-letter-routing-key", "catalog.product.activated.lost")
            .withArgument("x-delivery-limit", 5)
            .withArgument("x-message-ttl", 60000)
            .build();
}

@Bean
public Queue productActivatedDlq() {
    return QueueBuilder.durable("catalog.product.activated.lost").build();
}
```

#### Caso E — overrides en consumidor

```yaml
domainEvents:
  consumed:
    - name: PaymentCaptured
      channel: payments.payment.captured
      retry:
        maxAttempts: 10            # más tolerante que el default global
      dlq:
        target: orders.payment-captured.lost
```

Aplica los mismos `x-delivery-limit`, `x-message-ttl` y `x-dead-letter-routing-key` a la queue del consumidor.

### 4.5 Limitaciones declaradas

- `retry.backoff` y `retry.maxMs` están reservados pero aún no se traducen a infraestructura. Implementar un retry interceptor por evento exigiría cambios en los listeners (no incluido en Fase 4).
- Kafka no tiene equivalente declarativo a `x-delivery-limit`/`x-message-ttl` por topic — los hints `retry`/`dlq` aplicados a una BC con `broker: kafka` se ignoran. La gestión queda a cargo del `DefaultErrorHandler` configurado en runtime.
- `x-delivery-limit` requiere un broker compatible (RabbitMQ ≥ 3.10 con `x-queue-type: quorum`). El tipo de queue queda a discreción del operador en `parameters/{env}/rabbitmq.yaml`.

---

## Compatibilidad y migración

Un `bc.yaml` escrito antes de estas fases sigue compilando sin cambios. Los únicos puntos de fricción:

1. **Fase 1**: si declarabas `occurredAt` en algún `payload[]`, ahora aparece un `WARN` y el campo se filtra. Acción: bórralo del YAML.
2. **Fase 2**: si tu `bc-async-api.yaml` declaraba mensajes que el `bc.yaml` no exponía (o viceversa), ahora obtienes un INT-016/017. Acción: alinea los dos contratos o elimina el mensaje sobrante.
3. **Fase 3**: la heurística previa sigue activa cuando no declaras `source`. No requiere migración. Si quieres trazabilidad completa, declara `source` en todos los campos.
4. **Fase 4**: si no declaras `scope`, todos los eventos son `both` (comportamiento previo). Si no declaras `broker`, no hay headers, ni `partitionKey`, ni queue arguments — comportamiento previo.

---

## Ejemplo completo

```yaml
domainEvents:
  published:
    - name: ProductActivated
      version: 1
      description: >
        Emitted when a product transitions to ACTIVE.
      channel: catalog.product.activated
      scope: both
      broker:
        partitionKey: productId
        headers:
          tenantId: "${ctx.tenantId}"
          schemaVersion: "1"
        retry:
          maxAttempts: 5
          initialMs: 60000
        dlq:
          afterAttempts: 3
          target: catalog.product.activated.lost
      payload:
        - { name: productId,        type: Uuid,        source: aggregate, field: id }
        - { name: name,             type: String(200), source: aggregate }
        - { name: categoryId,       type: Uuid,        source: aggregate }
        - { name: price,            type: Money,       source: aggregate }
        - { name: sku,              type: String(100), source: aggregate }
        - { name: activationReason, type: String(50),  source: constant, value: MANUAL_ACTIVATION }
        - { name: actorId,          type: Uuid,        source: auth-context, claim: sub }

    - name: ProductPriceRecalculated
      scope: internal
      payload:
        - { name: productId, type: Uuid,  source: aggregate, field: id }
        - { name: newPrice,  type: Money, source: aggregate, field: price }

  consumed:
    - name: StockItemReserved
      channel: inventory.stock-item.reserved
      retry:
        maxAttempts: 10
      dlq:
        target: catalog.stock-reserved.lost
```

Con este YAML el generador produce:
- `ProductActivatedEvent` (record con `EventMetadata`) y `ProductActivatedIntegrationEvent`.
- `MessageBroker.publishProductActivatedIntegrationEvent(...)` y su adaptador con headers + partitionKey.
- Queue `catalog.product-activated` con TTL 60 s, delivery limit 5 y DLQ a `catalog.product.activated.lost`.
- `ProductPriceRecalculatedEvent` (record interno, sin integration event ni adaptador broker).
- Consumer queue para `StockItemReserved` con delivery limit 10 y DLQ a `catalog.stock-reserved.lost`.
- Trazabilidad completa: cada `raise()` y cada bean lleva su comentario `derived_from`.
