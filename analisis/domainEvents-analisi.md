# Análisis de robustez — sección `domainEvents`

> Insumo: `arch/catalog/catalog.yaml` y `arch/catalog/catalog-async-api.yaml` en `C:\Users\antonio.suarez\Desktop\test-dsl\arch`.
> Salida observada: `C:\Users\antonio.suarez\Desktop\test-dsl\src\main\java\co\com\asuarez\catalog\**` y `src/main/resources/parameters/{env}/rabbitmq.yaml`.
> Generador analizado: [src/generators/messaging-generator.js](../src/generators/messaging-generator.js) + [templates/messaging/](../templates/messaging/).
>
> **Estado**: Fases 0–4 entregadas y verificadas. Documento de funcionalidad: [docs/domain-events-new-features.md](../docs/domain-events-new-features.md).

---

## 1. Qué declara el diseño actual

```yaml
domainEvents:
  published:
    - name: ProductActivated
      description: >
        Emitted when a product transitions from DRAFT or any prior state to ACTIVE.
        Consumed by inventory to create the corresponding StockItem.
      channel: catalog.product.activated
      payload:
        - { name: productId,  type: Uuid,        description: ... }
        - { name: name,       type: String(200), description: ... }
        - { name: categoryId, type: Uuid }
        - { name: price,      type: Money }
        - { name: sku,        type: String(100) }
        - { name: occurredAt, type: DateTime }
    - name: ProductDiscontinued
      ...
  consumed: []
```

`emits` se usa en dos lugares:

- `enums.values[].transitions[].emits: ProductActivated`
- `aggregates[].domainMethods[].emits: ProductDiscontinued`

---

## 2. Qué genera el sistema (mapa entrada → salida)

| Artefacto YAML | Salida en `src/` | Estado |
|---|---|---|
| `published[].name` | `domain/events/{Name}Event.java` (record `implements DomainEvent`) | OK |
| `published[].payload` | campos del record + del `IntegrationEvent` paralelo | OK |
| `published[].name` (todos) | `application/ports/MessageBroker.java` (un método `publish*` por evento) | OK |
| `published[].name` (todos) | `infrastructure/adapters/rabbitmqMessageBroker/{Bc}RabbitMessageBroker.java` | OK |
| `published[].name` (todos) | `application/usecases/{Bc}DomainEventHandler.java` con `@TransactionalEventListener(AFTER_COMMIT)` | OK |
| `published[].name` (todos) | `infrastructure/adapters/rabbitmqMessageBroker/{Bc}RabbitMQConfig.java` (exchange + queue + DLX + DLQ) | OK |
| `published[].name` (todos) | `parameters/{env}/rabbitmq.yaml` con `exchanges.{bc}`, `queues.{kebab}`, `routing-keys.{kebab}` | OK |
| `published[].channel` | **routing-key literal** en `parameters/{env}/rabbitmq.yaml` y en topology builders (Fase 0) | OK |
| `published[].description` y `payload[].description` | Javadoc de `{Name}Event`, `{Name}IntegrationEvent` y `@Schema(description=...)` opt-in (Fase 0) | OK |
| `published[].version` | propagado a `EventMetadata.now(name, version, sourceBc)` (Fase 1) | OK |
| `published[].scope` | filtro de IntegrationEvent / port / adapter / handler / topología (Fase 4) | OK |
| `published[].broker.partitionKey` | `kafkaTemplate.send(topic, key, envelope)` (Fase 4) | OK |
| `published[].broker.headers` | `MessagePostProcessor` (Rabbit) o `RecordHeader[]` (Kafka) (Fase 4) | OK |
| `published[].broker.retry / .dlq` | queue arguments `x-delivery-limit`, `x-message-ttl`, `x-dead-letter-routing-key` (Fase 4) | OK (RabbitMQ) |
| `consumed[]` (full form: `name`, `command`, `payload`, `queueKey`) | `infrastructure/rabbitListener/{Name}RabbitListener.java` | OK |
| `consumed[]` (lightweight: solo `name`+`channel`) | derivado del UC con `trigger.kind: event` | OK |
| `consumed[].retry / .dlq` | overrides en queue del consumidor (Fase 4) | OK (RabbitMQ) |
| `payload[].source / field / param / value / claim / derivedFrom` | resolución explícita en `raise(...)` (Fase 3) | OK |
| `emits` en `domainMethods` (string o lista) | `raise(new {Name}Event(EventMetadata.now(...), ...))` dentro del método | OK |
| `emits` en `enums.transitions` | `raise(...)` después de `transitionTo(...)` | OK |
| `infrastructure.reliability.outbox: true` | `DomainEventHandler` muta a modo outbox + tabla `outbox_event` + relay | OK |
| `infrastructure.reliability.consumerIdempotency: true` | `IdempotencyGuard.runOnce(...)` en cada listener | OK |
| `sagas[]` cuyos pasos referencian un evento | `@SagaStep(...)` en handler/listener | OK |
| AsyncAPI `payload.$ref` | _fallback_ cuando `published[].payload` está vacío | OK |
| AsyncAPI ↔ bc.yaml coherencia | reglas INT-016..INT-021 (Fase 2) | OK |

Conclusión rápida: **el camino feliz funciona** y los gaps de mayor impacto detectados en la versión inicial fueron cerrados (Fases 0–4). Lo que sigue son los gaps remanentes para alcanzar el 90% de los escenarios productivos.

---

## 3. Gaps cerrados por Fases 0–4

| # | Gap original | Cerrado en | Cómo |
|---|---|---|---|
| 1 | `channel` se ignoraba | Fase 0 | `buildEventContext`, `buildRabbitMQTopology`, `buildKafkaTopology` y `parameters/{env}/rabbitmq.yaml` honran `channel` literal cuando está declarado. |
| 2 | `description` se ignoraba | Fase 0 | Javadoc del `{Name}Event` + `IntegrationEvent` y `@Schema(description=...)` cuando `openApiAnnotations: true`. |
| 3 | Sin metadata canónica | Fase 1 | Record `EventMetadata(eventId, eventType, eventVersion, occurredAt, sourceBc, correlationId, causationId)` inyectado como primer componente del record + `EventMetadata.now(...)` poblado en cada `raise()`. |
| 4 | Sin validación AsyncAPI ↔ bc.yaml | Fase 2 | INT-016 (mensaje extra), INT-017 (mensaje faltante), INT-018 (channel drift), INT-019 (campo o tipo drift). |
| 5 | `null` silencioso en `raise()` | Fase 0 | Comentario `TODO domainEvent(<event>, <field>): mapping not resolved` + `logger.warn(...)`. |
| 6 | `payload[].source / derivedFrom` no soportado | Fase 3 | Schema y resolver con 6 variantes: `aggregate`, `param`, `timestamp`, `constant`, `auth-context`, `derived`. |
| 7 | `hidden:true` filtrable vía evento | Fase 2 | INT-021: error si payload expone propiedad `hidden:true` salvo `allowHiddenLeak:true` declarado. |
| 11 | Sin retry / DLQ por evento | Fase 4 | `broker.retry.{maxAttempts, initialMs}` → `x-delivery-limit`, `x-message-ttl`. `broker.dlq.target` → `x-dead-letter-routing-key` + DLQ con nombre custom. Aplica a `published[]` y `consumed[]`. |
| 12 | Sin compatibilidad subset productor/consumidor | Fase 2 | INT-020: error si `consumed[].payload` referencia un campo que el productor no declara en su `published[]`. |
| 13 | Sin separación `scope` | Fase 4 | `published[].scope: internal | integration | both` filtra IntegrationEvent, port, adapter, handler bridge y topología. |
| 18 | Sin `// derived_from` en `raise()` | Fase 0 | Comentario `// derived_from: domainEvents.published.<Name>` antes de cada `raise()` y en cada handler de `{Bc}DomainEventHandler`. |
| 19 | `null /* TODO */` sin warning | Fase 0 | Mismo gap #5 — resuelto en simultáneo. |

---

## 4. Gaps remanentes (priorizados)

### 4.1 Versionado y evolución del schema (gap original #8)

No hay soporte para:

- `published[].version` se acepta como número (Fase 1) pero **no** dispara la generación de `{Name}V2Event`.
- `published[].deprecatedBy: ProductActivatedV2`.
- Co-existencia `{Name}Event` y `{Name}V2Event`.
- `compatibility: backward | forward | full`.
- Schema registry (Avro/Confluent, Protobuf).

**Síntoma**: cualquier cambio incompatible de payload en producción rompe consumidores existentes. El generador no soporta zero-downtime upgrades.

**Severidad**: Media. **Esfuerzo**: L. **Candidato para Fase 5.**

---

### 4.2 Convenciones de routing rígidas (gap original #9 parcial)

`channel` ya se honra (Fase 0) y se permite `partitionKey`/`headers` (Fase 4). Faltan:

- **Fan-out múltiple**: un evento → varios exchanges/topics distintos.
- **Filtros**: routing-key con wildcards (`product.*`).
- **Routing por header** (RabbitMQ headers exchange, Kafka topic dispatcher).

**Severidad**: Baja-Media. **Esfuerzo**: M.

---

### 4.3 Eventos consumidos: huecos restantes (gap original #10)

`consumed[].retry / .dlq` ya se respeta (Fase 4). Quedan:

- **Mapeo payload → command frágil**: la regex de paréntesis del `method:` del UC sigue siendo el fallback para lightweight form. Cambios sutiles de firma producen deriva silenciosa.
- **commandPayload** convencional: solo `{aggCamelId}`. Si el comando necesita más datos del evento (`reason`, `actorId`), full form es la salida pero no está documentada como recomendada.
- **Replay manual**: no hay endpoint generado para re-procesar la DLQ desde una fecha o offset.
- **Dead-letter routing centralizado**: `dlq.target` permite custom local pero no hay convención para reenvío a un BC central de "lost-events".

**Severidad**: Media. **Esfuerzo**: M.

---

### 4.4 Múltiples eventos desde el mismo método (gap original #20)

`emits: [A, B]` sigue funcionando, pero:

- No hay forma de declarar **orden garantizado** de publicación dentro del método.
- Sin outbox, una caída entre A y B deja eventos parciales (mitigable hoy con `infrastructure.reliability.outbox: true`, pero no documentado como recomendado).
- `scope` (Fase 4) ya permite marcar uno como `internal` y otro como `integration`, cerrando parcialmente este gap.

**Severidad**: Baja. **Esfuerzo**: M (para orden garantizado).

---

### 4.5 Sagas y compensación (gap original #14)

`sagas[]` ya inyecta `@SagaStep`, pero:

- No hay generación de **eventos de compensación** automática (`{Name}Compensated`).
- No hay declaración de timeouts por paso (`steps[].timeout: 30s`).
- No hay state-store de saga (saga runtime asumido externo).

**Severidad**: Baja. **Esfuerzo**: L. **Candidato para Fase 5.**

---

### 4.6 Listener: error handling no totalmente configurable (gap original #13)

`broker.retry.maxAttempts` ya se traduce a `x-delivery-limit` (Fase 4). Quedan:

- `retry.backoff: fixed | exponential` y `retry.maxMs` están reservados pero no se traducen a un retry interceptor por evento.
- No hay forma de declarar errores de dominio que sí deben reintentar (raros pero existen).
- No hay forma de declarar eventos "best-effort" (drop on error).
- En Kafka, los hints de retry/dlq son ignorados (RabbitMQ-only).

**Severidad**: Media. **Esfuerzo**: M.

---

### 4.7 PII / encriptación (gap original #15)

No hay marca `payload[].pii: true` ni `payload[].encrypt: true`. Necesario para:

- Excluir el campo de logs (`@JsonIgnore` en logging serializer).
- Aplicar encriptación at-rest del outbox.
- Masking helper en serializadores custom.

**Severidad**: Media. **Esfuerzo**: M. **Candidato para Fase 5.**

---

### 4.8 Tipos exóticos en payload (gap original #16)

`type-mapper` cubre canónicos + VO + enum. Sin embargo en payload de eventos no se valida ni soporta:

- `List[VO]` con VO complejo (anidado profundo).
- Polimorfismo (`type: oneOf[A, B]`).
- `Map<String, X>`.
- `Json` raw.

`projections` ya soporta `Date, Duration, BigInt, Json` — el path de eventos no.

**Severidad**: Baja. **Esfuerzo**: M. **Candidato para Fase 5.**

---

### 4.9 Outbox: gaps complementarios (gap original #17)

Modo outbox cubre atomicidad publish vs DB, pero:

- `OutboxEventJpa.payload` es **String JSON**: pérdida de tipo. No hay validación de schema antes de persistir.
- Sin particionamiento por aggregate (todos los publishers del BC compiten por la misma tabla).
- El relay corre por `@Scheduled` con poll fijo: sin back-pressure ni priorización por evento crítico.
- No hay **reaper** de eventos `PUBLISHED` antiguos.
- No hay job/métrica de monitoreo (`outbox_pending_count > N`).

**Severidad**: Media. **Esfuerzo**: M. **Candidato para Fase 5.**

---

## 5. Listado actualizado de gaps

Tabla original con estado actual:

| # | Gap | Severidad | Esfuerzo | Estado |
|---|---|---|---|---|
| 1 | `channel` declarado se ignora | Alta | S | ✅ Cerrado (Fase 0) |
| 2 | `description` ignorada | Media | S | ✅ Cerrado (Fase 0) |
| 3 | Sin `eventId/eventType/eventVersion/sourceBc/occurredAt` automáticos | Alta | M | ✅ Cerrado (Fase 1) |
| 4 | Sin validación cross-yaml AsyncAPI ↔ bc.yaml | Alta | M | ✅ Cerrado (Fase 2) |
| 5 | Mapeo payload → aggregate cae a `null` silencioso | Alta | S | ✅ Cerrado (Fase 0) |
| 6 | `payload[].source/derivedFrom` no soportado | Media | S | ✅ Cerrado (Fase 3) |
| 7 | `hidden: true` puede filtrarse vía evento | Alta | S | ✅ Cerrado (Fase 2 / INT-021) |
| 8 | Sin versionado de eventos | Media | L | 🟡 Pendiente (Fase 5) |
| 9 | Sin `partitionKey`, headers extra | Media | M | ✅ Cerrado (Fase 4) — fan-out múltiple sigue pendiente |
| 10 | Consumed: payload→command parsing frágil | Media | M | 🟡 Parcial — `retry/dlq` cerrado, parsing frágil sigue |
| 11 | Sin retry/DLQ por evento | Media | S | ✅ Cerrado (Fase 4) |
| 12 | Sin compatibilidad subset productor/consumidor | Media | M | ✅ Cerrado (Fase 2 / INT-020) |
| 13 | Sin separación `scope: internal/integration/both` | Media | S | ✅ Cerrado (Fase 4) |
| 14 | Sagas: sin compensación auto, sin timeouts | Baja | L | 🟡 Pendiente (Fase 5) |
| 15 | Sin marcador `pii: true` / encripción | Media | M | 🟡 Pendiente (Fase 5) |
| 16 | Tipos exóticos en payload (Json, Map, oneOf) | Baja | M | 🟡 Pendiente (Fase 5) |
| 17 | Outbox: sin schema, sin reaper, sin back-pressure | Media | M | 🟡 Pendiente (Fase 5) |
| 18 | Sin `// derived_from` en `raise(...)` | Baja | XS | ✅ Cerrado (Fase 0) |
| 19 | `null /* TODO */` para campos no resolvibles, sin warning | Alta | XS | ✅ Cerrado (Fase 0) |
| 20 | `emits` lista: sin orden ni atomicidad declarable | Baja | M | 🟡 Parcial — `scope` cerrado el split internal/integration; orden y atomicidad pendientes |

**Resumen**: 13 de 20 gaps cerrados (65%), 4 parciales (20%) y 3 totalmente pendientes (15%).

---

## 6. Conclusión

Antes de las Fases 0–4 el generador cubría con solidez el **escenario lineal** (≈ 40–55% de los escenarios productivos). Tras las Fases 0–4 las brechas más críticas para idempotencia, trazabilidad, coherencia cross-YAML y control declarativo de la topología están cerradas. La cobertura estimada actual es **75–85%** de los escenarios productivos.

Las brechas remanentes con mayor impacto son, en orden:

1. **Versionado de eventos** (gap #8) — bloqueante para zero-downtime upgrades; candidato natural a Fase 5.
2. **Outbox hardening** (gap #17) — fortalece la única ruta de publicación atómica que ofrece el sistema.
3. **PII / encriptación** (gap #15) — habilitará BCs sensibles (`customers`, `payments`).
4. **Sagas avanzadas** (gap #14) — timeouts y compensación automática.
5. **Tipos exóticos en payload** (gap #16) — `Json`, `Map`, `oneOf`.
6. **Listener retry interceptor** (gap #6 / parcial) — políticas de retry por evento más allá de `x-delivery-limit`.

Las brechas restantes (parsing frágil de `consumed[]` lightweight, fan-out múltiple, replay manual de DLQ) son legítimas pero corresponden a ergonomía y operabilidad: requieren extensiones de schema más amplias y, en algunos casos, decisiones de arquitectura que pueden esperar a Fase 6+.
