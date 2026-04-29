# Plan de remediación — gaps de `integrations`

> Documento complementario a [integrations-analisis.md](integrations-analisis.md).
> Define el orden, alcance, cambios de schema y entregables para cerrar cada gap.
> Pensado como roadmap incremental: cada fase produce un generador estable y
> testeable antes de empezar la siguiente.

---

## Principios rectores

1. **El YAML manda**. Cada gap se resuelve añadiendo el mínimo de schema
   necesario para que el generador actúe sin inferir.
2. **Backward-compatible**. Cada nuevo campo es opcional; el comportamiento
   actual no cambia si se omite.
3. **Fallar temprano**. Validación cruzada en `build.js` antes de empezar a
   escribir archivos.
4. **Una fase = un generador entregable**. Cada fase deja templates + tests +
   documentación en `docs/` antes de avanzar.
5. **Trazabilidad**. Cada artefacto generado lleva `// derived_from:
   <yaml-pointer>` en el header.

---

## Resumen del roadmap

| Fase | Objetivo | Gaps resueltos | Entregable principal |
|------|----------|----------------|----------------------|
| 0 | Validación cruzada | G0, G12 | `validation-mapper.js` extendido + `build --strict` |
| 1 | ACL externo | G2, G3, parte de G7/G8 (E1) | `external-adapter-generator.js` + 3 templates |
| 2 | Outbox + idempotencia consumidor | G4, G5 | `outbox-generator.js` + idempotency wrapper |
| 3 | Local Read Model | G10, D2-D4 | `projection-generator.js` extendido |
| 4 | Saga choreography asistida | G1 (parcial), C2-C6 | `saga-generator.js` (correlation + skeletons) |
| 5 | Resiliencia HTTP + auth | G7, G8, B5-B7 | extensión de `outbound-http-generator.js` |
| 6 | Versionado de evento + schema-per-BC | G6, F1, G11 | extensión `messaging-generator.js` + `@Table(schema)` |
| 7 | Webhooks entrantes + comandos async | G9, G14 | `webhook-generator.js`, sección `domainCommands` |
| 8 | Saga orquestada con persistencia | G1 (resto), C3-C5 | `SagaOrchestrator` + tabla `saga_instance` |
| 9 | Multi-broker + observabilidad | G13, F4-F5 | refactor de `infrastructure.messageBroker` a lista |

Cada fase tiene un criterio de salida (DoD) explícito al final de su sección.

---

## Fase 0 — Validación cruzada (G0, G12)

**Problema**: `system.integrations`, `bc.integrations.outbound|inbound` y
`bc.domainEvents.published|consumed` son tres fuentes de verdad superpuestas;
hoy nada las compara.

### Cambios al generador (sin tocar templates)

- `src/utils/validation-mapper.js`: nueva función
  `validateIntegrationCoherence(system, bcYamls)` que produce una lista de
  diagnósticos `{level, code, message, location}`.
- `src/commands/build.js`: ejecutar la validación al inicio. Con
  `--strict` (default `true`) `level: error` aborta la build.

### Reglas implementadas

| Código | Regla |
|--------|-------|
| `INT-001` | Toda `system.integrations[].contracts[]` con `pattern: event` debe estar en `domainEvents.published[]` del BC `from`. |
| `INT-002` | Y debe estar en `domainEvents.consumed[]` del BC `to` (o cualquier BC). |
| `INT-003` | Toda `system.integrations[]` con `pattern: customer-supplier` + `channel: http` requiere `<to>-internal-api.yaml` y un `inbound[]` con el mismo contrato en `bc.<to>.yaml`. |
| `INT-004` | Toda `system.integrations[]` con `pattern: acl` requiere `system.externalSystems[]` con el mismo `name`. |
| `INT-005` | Si el `channel` declarado (`a.b.c`) discrepa de `<from>.<kebab(eventName).split(-).join(.)>`, **warn** y registra el override. |
| `INT-006` | Cada `bc.integrations.outbound[]` debe tener una integración recíproca en `system.integrations`. |
| `INT-007` | No puede haber un `bc.domainEvents.consumed[].name` sin un BC que lo publique. |

### DoD
- 7 reglas con tests unitarios sobre fixtures (`tests/fixtures/integrations/*`).
- `dsl-springboot build --strict` falla en al menos un caso roto y pasa en `test-dsl`.
- Documentado en `docs/integrations-validation.md`.

---

## Fase 1 — ACL externo (G2, G3, E1)

**Problema**: `payment-gateway`, `email-provider`, `sms-provider` no producen
nada hoy.

### Cambios de schema

`system.yaml` ya tiene `externalSystems[]`. Se añade:

```yaml
externalSystems:
  - name: payment-gateway
    type: payment-gateway
    transport: http              # nuevo · http | smtp | sms-gateway | s3 …
    auth: { type: api-key, key: PAYMENT_GATEWAY_API_KEY }   # nuevo
    operations:                  # nuevo · contrato mínimo
      - name: chargeCard
        method: POST
        path: /charges
        request:  { type: ChargeCardRequest }
        response: { type: ChargeCardResult }
        errors:   [GatewayDeclined, GatewayTimeout]
```

`bc.integrations.outbound[]` admite:

```yaml
- name: payment-gateway
  type: externalSystem            # nuevo · valor además de internalBc
  pattern: acl
  protocol: http
  operations:
    - name: chargeCard            # debe existir en externalSystems[].operations
```

### Generador y templates

- Nuevo `src/generators/external-adapter-generator.js`.
- Nuevos templates:
  - `templates/application/ExternalClientPort.java.ejs`
  - `templates/infrastructure/adapters/external/ExternalRestClient.java.ejs`
    (Spring `RestClient` o `HttpExchange` interface)
  - `templates/infrastructure/adapters/external/ExternalAclMapper.java.ejs`
- Generación por cada `externalSystem` referenciado:
  - `application/ports/<Name>ClientPort.java`
  - `infrastructure/adapters/external/<Name>HttpAdapter.java` con `// TODO`
    en el cuerpo, anotaciones de auth (`@Bearer`, header `X-Api-Key`).
  - `infrastructure/adapters/external/<Name>AclMapper.java` (DTO ↔ dominio).
  - propiedades `integration.<name>.base-url` + `integration.<name>.api-key`
    en `urls.yaml` y `application-{env}.yaml`.

### DoD
- `payment-gateway`, `email-provider`, `sms-provider` se generan en `test-dsl` con `// TODO` en cada operación.
- Documentado en `docs/external-systems-guide.md`.

---

## Fase 2 — Outbox + idempotencia consumidor (G4, G5)

### Cambios de schema

`system.yaml`:

```yaml
infrastructure:
  reliability:
    outbox: true                  # nuevo
    consumerIdempotency: true     # nuevo
```

### Generador y templates

- `src/generators/outbox-generator.js`.
- Templates:
  - `templates/infrastructure/outbox/OutboxEventJpa.java.ejs` (id, aggregateType, eventType, payloadJson, status, createdAt, publishedAt, attempts).
  - `templates/infrastructure/outbox/OutboxRepository.java.ejs`.
  - `templates/infrastructure/outbox/OutboxPublisher.java.ejs` (`@Scheduled(fixedDelayString = "${app.outbox.poll-interval-ms:1000}")`).
  - Migración Flyway `V<n>__outbox.sql`.
- Modificar `DomainEventHandler.java.ejs`: si `outbox: true`, escribe a la
  tabla outbox **dentro** de la transacción y **no** publica directo al broker.
- Idempotencia: tabla `processed_event(eventId, handlerId, processedAt)`.
  Wrapper `IdempotentEventHandler` invocado al inicio de cada `*RabbitListener` /
  `*KafkaListener`. Si ya existe → ack y return.

### DoD
- Tests de integración con Testcontainers (Postgres + Rabbit) que prueban:
  pérdida de broker post-commit no pierde eventos; reentrega no duplica
  efectos.
- Flag opt-in: si `outbox: false`, comportamiento actual intacto.

---

## Fase 3 — Local Read Model (G10)

### Cambios de schema (`bc.yaml`)

```yaml
projections:
  - name: CustomerAddressSnapshot
    persistent: true                       # nuevo · default false
    source:                                # nuevo
      kind: event
      event: CustomerAddressUpdated
      from:  customers
    keyBy: customerId                      # nuevo
    properties:
      - { name: customerId, type: Uuid }
      - { name: street,    type: String(200) }
      - { name: city,      type: String(100) }
      - { name: updatedAt, type: DateTime }
    upsertStrategy: lastWriteWins          # lastWriteWins | versionGuarded
```

### Generador

- Extender `application-generator.js` (sección projections):
  - Si `persistent: true`, generar:
    - `infrastructure/persistence/projections/<Name>Jpa.java`
    - `infrastructure/persistence/projections/<Name>JpaRepository.java`
    - `application/projections/<Name>UpdaterEventHandler.java` (consume el
      evento, mappea, upsertea).
    - migración Flyway de la tabla.
  - Auto-registra el evento en `domainEvents.consumed[]` para que la Fase 0
    lo valide y la mensajería lo entregue.

### DoD
- Diseño `customers→orders/CustomerAddressSnapshot` se materializa sin código manual.

---

## Fase 4 — Saga choreography asistida (G1 parcial, C2-C6)

> Primer paso hacia sagas: aún sin orquestador, pero con correlation y
> esqueletos verificables.

### Cambios de schema (`system.yaml/sagas[]` ya existe)

Se exige:

```yaml
sagas:
  - name: CheckoutSaga
    style: choreography             # nuevo · choreography | orchestrated
    trigger: { event: OrderPlaced, bc: orders }
    steps:
      - { order: 1, bc: inventory, triggeredBy: OrderPlaced,
          onSuccess: StockReserved, onFailure: StockReservationFailed,
          compensation: StockReleased }
      …
```

Eventos referenciados deben existir en `domainEvents` (Fase 0 lo valida).

### Generador

- `src/generators/saga-generator.js`.
- Para cada saga `style: choreography`:
  - `application/sagas/<Saga>Handlers.java` (clase de **comentarios**: el
    cuerpo es una tabla en JavaDoc del paso, evento esperado, compensación).
    Se anota cada `*EventHandler` afectado con `@SagaStep(saga="CheckoutSaga", order=N)`.
  - Anotación + aspecto `@Saga` que propaga `sagaId/correlationId` por
    `EventEnvelope` automáticamente.
- Mediator → setea `correlationId = sagaId` en el primer `dispatch()` del trigger.

### DoD
- `EventEnvelope.correlationId` propaga end-to-end por todos los pasos de
  `CheckoutSaga` y queda en logs.
- Cada `*RabbitListener` afectado emite el `@SagaStep` correspondiente.

---

## Fase 5 — Resiliencia HTTP + auth declarativa (G7, G8)

### Cambios de schema

```yaml
# system.yaml o bc.integrations.outbound[]
- to: catalog
  channel: http
  resilience:                       # nuevo
    timeoutMs: 3000
    retries: 2
    circuitBreaker: { failureRateThreshold: 50, waitDurationMs: 30000 }
  auth:                             # nuevo
    type: oauth2-cc | api-key | mTLS | none
    tokenEndpoint: https://idp/token   # si oauth2-cc
    credentialKey: CATALOG_OAUTH      # nombre de variable de entorno
```

### Generador

- Extender `outbound-http-generator.js`:
  - Si `resilience` presente: anotaciones Resilience4j (`@CircuitBreaker`,
    `@Retry`, `@TimeLimiter`) + método `fallback*` con `// TODO`.
  - Si `auth.type: oauth2-cc`: genera `RequestInterceptor` Feign que añade
    `Authorization: Bearer …` + cliente token con cache.
  - Añade dependencias en `build.gradle` (Resilience4j, OAuth2 client) si
    aparece al menos una integración con resilience/auth.

### DoD
- Tests con WireMock validan retry, timeout y circuito abierto.

---

## Fase 6 — Versionado de evento + schema-per-BC (G6, F1, G11)

### Cambios de schema

```yaml
domainEvents:
  published:
    - name: ProductActivated
      version: 2                     # nuevo · default 1
      payload: [...]
      previousVersions:              # nuevo · opcional
        - version: 1
          payload: [...]
```

```yaml
infrastructure:
  database:
    isolationStrategy: schema-per-bc   # ya existe
```

### Generador

- `IntegrationEvent.java.ejs`: añade campo `int eventVersion` con default = `version`.
- Header `event-version` en RabbitMQ message properties / Kafka header.
- En el listener: dispatcher por `eventVersion` con N branches (uno por
  `previousVersions[]`).
- Si `isolationStrategy: schema-per-bc`: cada `*Jpa` genera
  `@Table(schema = "<bc>")` y el Flyway corre por schema (`flyway-{bc}`
  configuración multi-source).

### DoD
- v1 y v2 del mismo evento conviven; consumidor v1 no rompe.

---

## Fase 7 — Webhooks entrantes + comandos async (G9, G14)

### Cambios de schema

```yaml
integrations:
  inbound:
    - name: payment-gateway-webhook
      type: externalWebhook              # nuevo
      protocol: http
      path: /webhooks/payment-gateway
      verification:
        type: hmac-sha256
        headerName: X-Signature
        secretKey: PAYMENT_WEBHOOK_SECRET
      operations:
        - name: paymentSettled
          mapsTo: PaymentSettledCommand   # comando interno
```

```yaml
domainCommands:                         # nuevo · paralelo a domainEvents
  outbound: [...]
  inbound:  [...]
```

### Generador

- `src/generators/webhook-generator.js`:
  - Controller `infrastructure/rest/webhooks/<Name>WebhookController.java`
    con filtro de verificación HMAC.
  - Mapper webhook-payload → command.
- `domainCommands` reutiliza la pipeline de eventos (broker o HTTP) pero
  marca el mensaje como `command` en headers para que el consumidor responda
  con `command-reply`.

### DoD
- Webhook firmado con HMAC se acepta; firma inválida → 401.

---

## Fase 8 — Saga orquestada con persistencia (G1 resto)

> Sólo cuando el resto del stack está estable.

### Generador

- Saga `style: orchestrated`:
  - `application/sagas/<Saga>SagaOrchestrator.java` con un método por
    `step` y método `compensate*` por compensación.
  - Tabla `saga_instance(id, type, currentStep, state, payloadJson,
    createdAt, updatedAt)`.
  - State machine driver invocado desde el listener del trigger.
  - Timeout-watchdog (`@Scheduled`) que detecta sagas colgadas.

### DoD
- `CheckoutSaga` con falla en step 3 ejecuta `StockReleased` automáticamente.

---

## Fase 9 — Multi-broker y observabilidad (G13, F4-F5)

### Cambios de schema

```yaml
infrastructure:
  messageBrokers:                  # ahora lista (deprecación gradual de boolean)
    - id: rabbit-main
      type: rabbitmq
      usedFor: [events, commands]
    - id: kafka-analytics
      type: kafka
      usedFor: [analytics]
```

`domainEvents.published[].brokerRef: rabbit-main` (default = primer broker).

### Generador

- Refactor: `messaging-generator.js` itera por broker y agrupa eventos por
  `brokerRef`.
- Observabilidad: integración Micrometer + OTel en `EventEnvelope`
  (`traceparent` header), métricas `dlq.depth`, `consumer.lag`.

### DoD
- Sistema con Rabbit + Kafka simultáneos arranca y publica/consume en cada uno.

---

## Estimación relativa de esfuerzo

| Fase | Esfuerzo (puntos relativos) | Riesgo |
|------|-----------------------------|--------|
| 0    | 3   | Bajo |
| 1    | 5   | Bajo |
| 2    | 8   | Medio |
| 3    | 5   | Bajo |
| 4    | 5   | Medio |
| 5    | 5   | Bajo |
| 6    | 5   | Medio |
| 7    | 5   | Bajo |
| 8    | 8   | Alto |
| 9    | 8   | Alto |

> Total ≈ 57 puntos. La cadena crítica para “producción seria” termina al
> cierre de Fase 5; las Fases 6–9 son robustez avanzada.

---

## Cambios transversales aplicables desde la Fase 0

- **Trazabilidad**: añadir helper `derivedFromComment(yamlPath)` en
  `template-engine.js` y consumirlo en cada template (`<%= derivedFrom('system.yaml#integrations[2]') %>`).
- **Convenciones documentadas**: `docs/integrations-conventions.md` con la
  tabla canon (channel naming, exchange, routing key, queue, DLQ).
- **Tests de regresión**: snapshot tests por fase sobre `test-dsl`. Cualquier
  fase que rompa snapshots existentes debe documentar el cambio en
  `CHANGELOG.md`.

---

## Criterios globales de éxito

1. `dsl-springboot build --strict` falla con mensajes claros para cada
   inconsistencia (`INT-00x`).
2. El proyecto `test-dsl` actual sigue compilando y pasando tests **sin
   añadir nada al YAML** (todas las fases son opt-in).
3. Un proyecto que active **todas** las features (outbox, sagas orquestadas,
   external systems, webhooks, multi-broker) compila y arranca con un único
   `dsl-springboot build`.
4. La documentación de cada fase incluye un ejemplo end-to-end mínimo en
   `docs/`.

---

## Próximos pasos inmediatos

1. Acordar el alcance de **Fase 0** y crear los fixtures de prueba.
2. Implementar `validation-mapper.js#validateIntegrationCoherence` con las 7
   reglas y `dsl-springboot build --strict`.
3. Cerrar Fase 0 (incluye actualizar `AGENTS.md` con la nueva regla de
   validación cruzada) antes de tocar templates.
