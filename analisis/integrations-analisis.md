# Análisis profundo — Sección `integrations` vs. código generado

> Fecha: 2026-04-29
> Diseño analizado: `C:\Users\antonio.suarez\Desktop\test-dsl\arch`
> Código generado: `C:\Users\antonio.suarez\Desktop\test-dsl\src`
> Generador: `dsl-springboot-generator` (workspace actual)
>
> **Objetivo**: evaluar la robustez del generador frente a la sección `integrations`
> del `system.yaml` y la sección `integrations` + `domainEvents` de cada `{bc}.yaml`,
> e identificar gaps que limitan la cobertura de escenarios reales.
>
> **Estado tras entrega de fases 0–5** (abril 2026): los gaps críticos y de alta
> prioridad identificados en este documento (G0–G2, G4–G5, G7–G8, G10, C2,
> D2–D4, E1, B4–B7) están **cerrados**. Las fases entregadas son retro-compatibles
> y opt-in. Ver §7 para el detalle de lo implementado y los gaps que permanecen
> abiertos. La documentación de uso está en
> [docs/integrations-new-features.md](../docs/integrations-new-features.md).

---

## 1. Modelo conceptual del input

La información de integración vive **en dos capas** y se duplica parcialmente:

### 1.1 `system.yaml` — vista global (estratégica)

Lista plana en `integrations[]` con la forma:

```yaml
integrations:
  - from: <bc>
    to:   <bc | externalSystem>
    pattern: customer-supplier | event | acl
    channel: http | message-broker
    contracts:
      - <stringContract>           # para http
      - { name: EventName, channel: dotted.topic.name }   # para events
    notes: >
```

Combinaciones presentes en el diseño de prueba:

| pattern             | channel        | Ejemplo (test-dsl)                     |
|---------------------|----------------|----------------------------------------|
| `customer-supplier` | `http`         | orders → catalog (`validateProductAndSnapPrice`) |
| `event`             | `message-broker` | catalog → inventory (`ProductActivated`)        |
| `acl`               | `http`         | payments → payment-gateway, notifications → email-provider |

Adicionalmente existe `externalSystems[]` y un bloque `sagas[]` que declara
`CheckoutSaga` con steps + compensaciones.

### 1.2 `{bc}.yaml` — vista táctica (por BC)

Expone **dos sub-secciones independientes**:

```yaml
integrations:
  outbound: [{ name, type, pattern, protocol, operations[] }]
  inbound:  [{ name, type, pattern, protocol, operations[] }]

domainEvents:
  published: [{ name, channel, payload[] }]
  consumed:  [{ name, channel, … }]
```

`integrations.outbound` describe lo que el BC **consume** vía HTTP/broker;
`integrations.inbound` lo que el BC **expone**. `domainEvents.published/consumed`
describe el contrato de eventos (en paralelo a `integrations.*` con `protocol:
message-broker`).

> **Observación de diseño**: el mismo hecho se declara hasta tres veces (en
> `system.yaml/integrations`, en `{bc}.yaml/integrations.outbound|inbound` y en
> `{bc}.yaml/domainEvents.published|consumed`). El generador no valida la
> coherencia entre las tres fuentes — gap transversal G0 (ver §4).

---

## 2. Mapa de qué genera el generador hoy

| Capa generada                                             | Driver del input                                                   | Archivo/Template                                              |
|-----------------------------------------------------------|--------------------------------------------------------------------|---------------------------------------------------------------|
| `application/events/<Event>IntegrationEvent.java`         | `domainEvents.published[]`                                          | [IntegrationEvent.java.ejs](../templates/messaging/IntegrationEvent.java.ejs) |
| `domain/events/<Event>Event.java`                         | `domainEvents.published[]`                                          | [DomainEvent.java.ejs](../templates/messaging/DomainEvent.java.ejs) |
| `application/usecases/<Bc>DomainEventHandler.java`        | `domainEvents.published[]`                                          | [DomainEventHandler.java.ejs](../templates/messaging/DomainEventHandler.java.ejs) |
| `application/ports/MessageBroker.java`                    | siempre que `infrastructure.messageBroker: true`                    | [MessageBroker.java.ejs](../templates/messaging/MessageBroker.java.ejs) |
| `infrastructure/adapters/.../<Bc>RabbitMessageBroker.java` | broker = rabbitmq                                                   | [RabbitMessageBroker.java.ejs](../templates/messaging/RabbitMessageBroker.java.ejs) |
| `infrastructure/adapters/.../<Bc>RabbitMQConfig.java`     | broker = rabbitmq + `domainEvents.published/consumed`               | [BcRabbitMQConfig.java.ejs](../templates/messaging/BcRabbitMQConfig.java.ejs) |
| `infrastructure/adapters/.../<Event>RabbitListener.java`  | `domainEvents.consumed[]`                                           | [RabbitListener.java.ejs](../templates/messaging/RabbitListener.java.ejs) |
| `shared/.../rabbitmqConfig/RabbitMQConfig.java` (retry)   | hay broker rabbitmq                                                 | [RabbitMQConfig.java.ejs](../templates/messaging/RabbitMQConfig.java.ejs) |
| `infrastructure/adapters/<bc>FeignClient + AclMapper`     | `bc.integrations.outbound[].protocol == 'http'` **+** existencia de `arch/<targetBc>/<targetBc>-internal-api.yaml` | [outbound-http-generator.js](../src/generators/outbound-http-generator.js) |
| `application/ports/<Target>ServicePort.java`              | mismo trigger que el adaptador                                      | [ServicePort.java.ejs](../templates/application/ServicePort.java.ejs) |
| `infrastructure/rest/.../<Aggregate>V1Controller.java` con `/internal/*` `@Operation(hidden=true)` | `<bc>-internal-api.yaml` (paths) + use cases declarados | [AggregateV1Controller.java.ejs](../templates/controller/AggregateV1Controller.java.ejs) + [controller-generator.js](../src/generators/controller-generator.js) |
| `resources/parameters/{env}/urls.yaml`                    | `system.integrations[].channel == 'http'` (todos los `to`)         | [base-project-generator.js](../src/generators/base-project-generator.js) `buildHttpIntegrations()` |

Esto cubre, contra el catálogo del diseño de prueba, los siguientes hechos:

- **catalog publica `ProductActivated` y `ProductDiscontinued`** → ✅ generados
  `IntegrationEvent`, `DomainEvent`, `CatalogDomainEventHandler`,
  `CatalogRabbitMessageBroker`, `CatalogRabbitMQConfig` con exchange + binding
  + DLX/DLQ.
- **catalog expone `validateProductAndSnapPrice` para orders** → ✅ generado
  endpoint interno en `ProductV1Controller` (`/internal/products/validate-and-snap-price`,
  `@Operation(hidden = true)`), `ValidateProductAndSnapPriceQuery` + handler.
- **catalog no consume eventos** → consistente: 0 listeners generados.
- **catalog no llama a otros BC ni a sistemas externos** → consistente: 0 adapters salientes.

> El subset generado para `catalog` es **correcto y completo** para sus
> responsabilidades declaradas. La duda sobre la robustez surge al proyectar el
> generador sobre el resto del sistema (`orders`, `payments`, `dispatch`,
> `notifications`, `inventory`, `customers`, `auth`).

---

## 3. Cobertura por escenario

Leyenda: ✅ soportado · 🟡 parcial · ❌ no soportado

### 3.1 Mensajería asíncrona

| # | Escenario | Estado | Evidencia |
|---|-----------|--------|-----------|
| A1 | Producir evento de dominio con publicación post-commit | ✅ | `@TransactionalEventListener(AFTER_COMMIT)` en `DomainEventHandler.java.ejs` |
| A2 | Topología RabbitMQ (exchange + queue + binding + DLX/DLQ) | ✅ | `BcRabbitMQConfig.java.ejs` declara los beans |
| A3 | Listener con retry exponencial + DLQ | ✅ | `RabbitMQConfig.java.ejs` + `RabbitListener.java.ejs` |
| A4 | Mismo evento consumido por múltiples BC (fan-out) | ✅ | exchange compartido, una queue por consumidor BC |
| A5 | Multi-broker (Rabbit vs Kafka, mismo grafo de eventos) | ✅ | `messaging-generator.js` hace dispatch + ambos templates existen |
| A6 | Routing por contenido (`x-event-type` header / routing key derivada) | ✅ | `routingKey = kebab(eventName)` |
| A7 | **Outbox pattern transaccional con tabla y poller** | ✅ | Cerrado en fase 2 (`infrastructure.reliability.outbox: true`): tabla `outbox_event` + `OutboxPublisher` `@Scheduled` + Flyway. Ver §7.3. |
| A8 | **Idempotencia del consumidor** (event id store) | ✅ | Cerrado en fase 2 (`infrastructure.reliability.consumerIdempotency: true`): `ProcessedEventJpa` + `IdempotencyGuard.runOnce(...)` envolviendo listeners. Ver §7.3. |
| A9 | **Versionado de evento** (`eventVersion`, dispatcher por versión) | ❌ | El record no tiene campo `version` |
| A10 | **Schema registry / validación del payload al consumir** | ❌ | Deserialización directa con Jackson, sin esquema central |
| A11 | **Política de reintentos por tipo de evento** (no global) | ❌ | El backoff vive en `application.yaml` global |
| A12 | **Topic namespacing por tenant / entorno** | ❌ | El nombre del exchange/topic se deriva solo del BC |
| A13 | **Wildcard / topic exchange con routing patterns** (`order.#`) | ❌ | Cada evento se bindea con su routing key exacto |
| A14 | **Headers exchange / message TTL / priority** | ❌ | No hay ganchos en el YAML |
| A15 | **Stream / batching (Kafka Streams, RabbitMQ Streams)** | ❌ | Solo listener punto-a-punto |
| A16 | **Múltiples brokers en paralelo** (Kafka + Rabbit en el mismo sistema) | ❌ | `infrastructure.messageBroker` es boolean único |

### 3.2 Sincrónico HTTP

| # | Escenario | Estado | Evidencia |
|---|-----------|--------|-----------|
| B1 | Lado proveedor: endpoint interno `/internal/*` con `@Operation(hidden=true)` | ✅ | `ProductV1Controller#validateProductAndSnapPrice` |
| B2 | Lado cliente: cliente Feign + `ServicePort` + `AclMapper` para BC interno | ✅ | `outbound-http-generator.js` |
| B3 | Inyección automática de `@FeignClient(url = "${integration.<bc>.base-url}")` y propiedad en `urls.yaml` | ✅ | `buildHttpIntegrations()` en `base-project-generator.js` |
| B4 | **Cliente HTTP a sistema externo** (`pattern: acl`, externalSystem) | ✅ | Cerrado en fase 1: [`external-adapter-generator.js`](../src/generators/external-adapter-generator.js) emite 7 artefactos (port, domain models, DTOs, `<Ext>FeignClient`, `<Ext>FeignConfig` con auth+timeouts, `<Ext>FeignAdapter`, `<Ext>AclMapper`) reusando los templates `Outbound*`. Ver §7.2. |
| B5 | **Circuit breaker / fallback** (Resilience4j) | ✅ | Cerrado en fase 5: `@CircuitBreaker` + `@Retry` en `OutboundFeignAdapter` con método `*Fallback` privado (`// TODO`); config en `parameters/{env}/resilience.yaml`. Ver §7.6. |
| B6 | **Timeouts / retry HTTP por integración** | ✅ | Cerrado en fase 5: `*.resilience: { timeoutMs, connectTimeoutMs, retries, circuitBreaker }` con precedencia bc → system; timeouts vía `Request.Options`. Ver §7.6. |
| B7 | **mTLS / API-key / OAuth2 client-credentials** por integración | ✅ | Cerrado en fase 5 para api-key, bearer y oauth2-cc (`OAuth2ClientCredentialsSupport`); mTLS sigue como placeholder. Ver §7.6. |
| B8 | **Versionado del contrato cliente** (`/v1`, `/v2` simultáneos) | 🟡 | Versionado URL OK; coexistencia v1+v2 cliente requiere duplicar manualmente |
| B9 | **GraphQL / gRPC / SOAP** para clientes salientes | ❌ | Solo REST/Feign |
| B10 | **WebClient/RestClient reactivo** como alternativa a Feign | ❌ | Forzado a Feign |
| B11 | **Soporte de paginación / `Pageable` en endpoints internos** | 🟡 | El mediator dispatcha Query como POST; no genera `?page&size` automáticamente |

### 3.3 Sagas y orquestación

| # | Escenario | Estado | Evidencia |
|---|-----------|--------|-----------|
| C1 | Choreography manual (handler por evento) | ✅ | Cerrado en fase 4: `@SagaStep` decora handlers cuando el evento pertenece a un step coreografiado; constantes `<Saga>SagaSteps.java`. Ver §7.5. |
| C2 | **Generar correlationId / sagaId end-to-end** | ✅ | Cerrado en fase 4: `CorrelationContext` (ThreadLocal + MDC) propaga `correlationId` desde controllers a través de listeners y publishers. Ver §7.5. |
| C3 | **`sagas[]` del `system.yaml` se materializa** (orchestrator + steps + compensations) | 🟡 | Choreography cubierta en fase 4; orquestador persistente queda para fase 8. |
| C4 | **Process manager / orquestador con persistencia de estado** | ❌ | Pendiente fase 8 (tabla `saga_instance` + máquina de estados). |
| C5 | **Timeouts y reintentos a nivel saga** (paso colgado) | ❌ | Pendiente fase 8 (scheduler + alarms). |
| C6 | **Eventos de compensación generados** (e.g. `StockReleased`) | ✅ | Cerrado en fase 4: el step declara `compensation:` y se materializa como `@SagaStep` con tipo `compensation`. Ver §7.5. |

### 3.4 Local Read Model / Projections

| # | Escenario | Estado | Evidencia |
|---|-----------|--------|-----------|
| D1 | Projection como DTO de respuesta | ✅ | `Projection.java.ejs` genera `record` |
| D2 | **Projection materializada por evento** (tabla + listener que pobla) | ✅ | Cerrado en fase 3 (`projections[].persistent: true` + `source: { kind: event, event, from }`): JPA + repo + `ProjectionUpdaterEventHandler` con upsert. Ver §7.4. |
| D3 | **Reposición histórica (replay) de la projection** | ❌ | Pendiente: no hay endpoint de replay ni cursor de offset. |
| D4 | **Repositorio dedicado a la projection** (`@Repository` Jpa) | ✅ | Cerrado en fase 3: `JpaRepository` dedicado por proyección persistente. Ver §7.4. |
| D5 | **CDC / Debezium** como alternativa a eventos de dominio | ❌ | Fuera del alcance del generador hoy |

### 3.5 ACL e integraciones externas

| # | Escenario | Estado | Evidencia |
|---|-----------|--------|-----------|
| E1 | `pattern: acl` con `channel: http` (payment-gateway, email-provider, sms-provider) | ✅ | Cerrado en fase 1: `external-adapter-generator.js` materializa port + adapter Feign + AclMapper + DTOs + config con auth e timeouts. Ver §7.2 / §B4. |
| E2 | ACL con sandbox/mock por entorno | ❌ | Sin gancho |
| E3 | **Webhook entrante** (proveedor llama a nuestro endpoint) | ❌ | No hay `inbound: { type: externalWebhook }` |
| E4 | Verificación de firma HMAC del webhook | ❌ | — |
| E5 | Rate-limit / quotas por integración | ❌ | — |

### 3.6 Infraestructura transversal

| # | Escenario | Estado | Evidencia |
|---|-----------|--------|-----------|
| F1 | `infrastructure.database.isolationStrategy: schema-per-bc` | 🟡 | El YAML lo declara pero no se traduce a `@Table(schema=…)` ni a Flyway por schema |
| F2 | Multi-tenant (DB-per-tenant / schema-per-tenant) | ❌ | — |
| F3 | Modular monolith vs micro-servicios (split físico) | 🟡 | Hoy todo va a un único Gradle module; no hay flag de “explode-to-microservices” |
| F4 | Observabilidad: `traceId/spanId` propagados en eventos y headers HTTP | 🟡 | `EventEnvelope` lleva `correlationId`, pero no hay integración Micrometer/OTel scaffolded |
| F5 | Métricas de DLQ depth / consumer lag | ❌ | — |

---

## 4. Gaps transversales (independientes del escenario)

Leyenda de estado: ✅ cerrado por una fase entregada · 🟡 parcial · ⏳ pendiente.

| ID | Gap | Impacto | Severidad | Estado |
|----|-----|---------|-----------|--------|
| G0 | **Triple fuente de verdad sin validación cruzada**: `system.yaml/integrations` ↔ `{bc}.yaml/integrations.outbound|inbound` ↔ `{bc}.yaml/domainEvents.published|consumed`. | Drift entre estratégico y táctico → contratos imaginarios. | 🔴 Alto | ✅ Fase 0 (INT-001..INT-007) |
| G1 | El bloque `sagas[]` de `system.yaml` no se procesa. | Diseño expresado pero invisible al código. | 🔴 Alto | 🟡 Fase 4 (choreography); orquestada → fase 8 |
| G2 | `externalSystems[]` no se procesa (no hay adaptador, port ni mapper). | Cada integración ACL se implementa a mano → riesgo OWASP A04/A09. | 🔴 Alto | ✅ Fase 1 |
| G3 | No existe `type: externalSystem` en `integrations.outbound` del BC. | Sin punto de extensión para ACL externo. | 🔴 Alto | ✅ Fase 1 |
| G4 | Ausencia de outbox real (solo `AFTER_COMMIT`). | Pérdida silenciosa de eventos si el broker falla post-commit. | 🟠 Medio | ✅ Fase 2 (`reliability.outbox: true`) |
| G5 | Sin idempotencia de consumidor. | Reentregas → efectos duplicados (cobros, stock, notificaciones). | 🟠 Medio | ✅ Fase 2 (`reliability.consumerIdempotency: true`) |
| G6 | Sin versionado de evento (`eventVersion`, content-type). | Schema evolution rompe consumidores. | 🟠 Medio | ⏳ Fase 6 |
| G7 | Sin scaffolding de resiliencia HTTP (CB, retry, timeout, bulkhead) por integración. | Cascadas de fallos. | 🟠 Medio | ✅ Fase 5 |
| G8 | Sin metadatos de seguridad por integración (`auth: { type: oauth2-cc/api-key/mTLS }`). | Configuración manual y propensa a olvidos. | 🟠 Medio | ✅ Fase 5 (api-key, bearer, oauth2-cc) |
| G9 | Sin webhook entrante ni firma HMAC. | Casos comunes (gateways, proveedores) requieren código manual. | 🟡 Bajo-Medio | ⏳ Fase 7 |
| G10 | Sin replay/projection updater (LRM). | El patrón LRM declarado en `system.yaml` (customers→orders) no se concreta. | 🟠 Medio | ✅ Fase 3 |
| G11 | `infrastructure.database.isolationStrategy` y `deployment.strategy` son "documento", no se reflejan en código. | Diseño no operativo. | 🟡 Bajo | ⏳ Pendiente |
| G12 | El `channel:` del evento en `system.yaml` no se compara con la routing key derivada. | Drift documentación ↔ runtime. | 🟡 Bajo | ✅ Fase 0 (INT-005, warn) |
| G13 | El generador asume un único broker. Sistemas reales coexisten Kafka + Rabbit + SQS. | No soportado. | 🟡 Bajo | ⏳ Fase 9 |
| G14 | No hay distinción entre **comando asincrónico** y **evento de dominio**. | Patrones request-reply async no expresables. | 🟡 Bajo | ⏳ Pendiente |
| G15 | El bloque `notes` de cada integración es referencia humana. | Trazabilidad incompleta. | 🟢 Bajo | ✅ Fase 0 (helper `derived_from`) |

---

## 5. Recomendaciones priorizadas

### 5.1 Crítico — habilita escenarios reales hoy bloqueados

1. **Generador de ACL externo** (G2, G3, E1).
   - Extender `bc.integrations.outbound[]` con `type: externalSystem` y
     `auth: { type, credentialsKey }`.
   - Resolver `to: payment-gateway` contra `system.externalSystems[]`.
   - Generar:
     - `application/ports/<Target>ClientPort.java`
     - `infrastructure/adapters/external/<Target>HttpAdapter.java` (RestClient/Feign)
     - `infrastructure/adapters/external/<Target>AclMapper.java`
     - propiedades `integration.<target>.base-url` + `auth.*` en `urls.yaml`.

2. **Validador cruzado en `build.js`** (G0).
   - Fallar la build si:
     - un `system.integrations.contracts[].name` (event) no aparece en
       `domainEvents.published[]` del BC `from` o en `consumed[]` del BC `to`;
     - un `system.integrations.contracts[]` (http) no aparece en
       `integrations.inbound[].operations[]` del BC `to` o en `outbound[]` del `from`;
     - un canal en `system.integrations` discrepa del derivado por convención.

3. **Saga scaffold mínimo** (G1, C2-C5).
   - Procesar `system.sagas[]`. Generar:
     - `application/sagas/<SagaName>SagaOrchestrator.java` con un método por step + `@Compensate`.
     - Tabla `saga_instance` (id, type, state, lastStep, payload, createdAt).
     - Inyección de `correlationId` desde el primer use case y propagación por el `EventEnvelope`.

### 5.2 Alta — robustez en producción

4. **Outbox transaccional opcional** (G4).
   - Flag `infrastructure.outbox: true` en `system.yaml`.
   - Generar: tabla `outbox_event`, escritura desde `<Bc>DomainEventHandler` antes del commit, scheduler `@Scheduled` que consume y publica.

5. **Idempotencia del consumidor** (G5).
   - Tabla `processed_event(eventId, handlerId, processedAt)`.
   - Wrapper en `*RabbitListener` / `*KafkaListener` que comprueba antes de despachar.

6. **Local Read Model (Projection alimentada por evento)** (G10, D2-D4).
   - Permitir `projections[]` con `source: event:<EventName> from <bc>`.
   - Generar entidad JPA + repositorio + listener que upsertea.

7. **Resiliencia HTTP** (G7, B5-B6).
   - Sección `integrations.outbound[].resilience: { timeoutMs, retries, circuitBreaker }`.
   - Generar `@CircuitBreaker` (Resilience4j), config en `application.yaml`, fallback method con `// TODO`.

### 5.3 Media — cobertura de escenarios secundarios

8. **Versionado de eventos** (G6) — `domainEvents.published[].version` + dispatcher por versión.
9. **Webhooks entrantes** (G9) — `integrations.inbound[].type: externalWebhook` con verificación HMAC.
10. **Auth por integración** (G8) — `auth: { type: oauth2-cc | api-key | mTLS, … }`.
11. **Schema-per-BC efectivo** (F1, G11) — `@Table(schema = "<bc>")` + Flyway por schema.
12. **Comando asincrónico vs evento** (G14) — `domainCommands.outbound[]` separado.

### 5.4 Baja — calidad

13. Validar coherencia del campo `channel` con la convención (G12) — warn si difieren.
14. Emitir `// derived_from: system.yaml#integrations[<i>]` en el header de los IntegrationEvent y de los listeners (G15).

---

## 6. Conclusión (estado original — abril 2026, antes de fases 0–5)

Para el subset de `catalog` el código generado es **completo y consistente**
con los artefactos: hay un evento publicado con su `IntegrationEvent`,
`DomainEventHandler` post-commit, exchange + DLX, y un endpoint interno
`/internal/*` correctamente oculto del OpenAPI público. El generador es sólido
para el **happy path** de:

- mensajería asíncrona pub/sub con un broker único,
- HTTP customer-supplier BC↔BC con contrato `internal-api.yaml`,
- versionado URL `/v1/`.

La robustez se degrada cuando el diseño exige:

- integraciones con sistemas **externos** (ACL),
- patrones de **saga** declarativos (con compensaciones, correlation, persistencia),
- garantías de entrega más fuertes (**outbox**, **idempotencia**, **versionado**),
- read models materializados por eventos (**LRM**),
- **resiliencia** y **seguridad** declarativas por integración,
- coexistencia de **múltiples brokers** o de **mensajería + webhooks**.

Resolver primero los gaps **G0–G3** (validador cruzado, ACL externo, saga
mínima) elimina la mayor parte del código manual recurrente hoy y mantiene el
principio rector del proyecto: el YAML es la fuente de verdad y el generador
no infiere — falla limpio cuando falta información.

---

## 7. Estado de entrega — fases 0–5 (actualización)

Las seis fases del plan de remediación (`analisis/integrations-remediation-plan.md`)
fueron entregadas y verificadas con smoke-tests sobre el fixture `test-dsl` en
modo baseline (sin nuevas declaraciones → no-op) y en modo flag-on (con cada
feature activada → artefactos generados correctos).

### 7.1 Fase 0 — Validador cross-YAML + helper `derived_from`

- **Cierra**: G0, G12 (warn), G15.
- **Entregables**: [`src/utils/integration-validator.js`](../src/utils/integration-validator.js)
  con reglas INT-001..INT-015 (códigos numerados); flag CLI `--strict` (default `true`)
  vía [`bin/dsl-springboot.js`](../bin/dsl-springboot.js); helper
  [`src/utils/derived-from.js`](../src/utils/derived-from.js) expuesto a EJS.
- **Verificación**: el fixture `test-dsl` falla con `INT-003` por la integración
  `payments → orders` que carece de `arch/orders/orders-internal-api.yaml`
  (esperado dado el dataset incompleto del fixture).

### 7.2 Fase 1 — Sistemas externos como ACL

- **Cierra**: G2, G3, E1, B4.
- **Schema**: `system.externalSystems[]` acepta `baseUrlProperty`, `auth`,
  `operations[].{ name, method, path, request, response, errors }`;
  `bc.integrations.outbound[]` acepta `type: externalSystem` con `operations[]`
  para seleccionar qué operaciones expone el adaptador.
- **Entregables** ([`src/generators/external-adapter-generator.js`](../src/generators/external-adapter-generator.js)):
  por cada `(bc, externalSystem)` referenciado se emiten **7 artefactos**:
  1. `application/ports/<Ext>ServicePort.java` (reusa `OutboundPortInterface.java.ejs`).
  2. `domain/models/<ext>/<DomainModel>.java` por modelo derivado
     ([`ExternalDomainModel.java.ejs`](../templates/infrastructure/adapters/external/ExternalDomainModel.java.ejs)).
  3. `infrastructure/adapters/<ext>/dtos/<Op>RequestDto.java` y `<Op>ResponseDto.java`
     ([`ExternalDto.java.ejs`](../templates/infrastructure/adapters/external/ExternalDto.java.ejs)).
  4. `infrastructure/adapters/<ext>/<Ext>FeignClient.java` (`@FeignClient`,
     reusa `OutboundFeignClient.java.ejs`).
  5. `infrastructure/adapters/<ext>/<Ext>FeignConfig.java`
     ([`ExternalRestConfig.java.ejs`](../templates/infrastructure/adapters/external/ExternalRestConfig.java.ejs))
     con interceptor de auth e `Request.Options` (timeouts).
  6. `infrastructure/adapters/<ext>/<Ext>FeignAdapter.java` (implementa el port,
     reusa `OutboundFeignAdapter.java.ejs`).
  7. `infrastructure/adapters/<ext>/<Ext>AclMapper.java`
     ([`ExternalAclMapper.java.ejs`](../templates/infrastructure/adapters/external/ExternalAclMapper.java.ejs))
     con `// TODO` por método y `derived_from:` por campo.
- **Validaciones**: INT-008 (operación declarada en `system.externalSystems`),
  INT-009 (`auth.key` SCREAMING_SNAKE).
- **Decisión técnica**: se reutilizan los templates de integración BC↔BC
  (`OutboundFeignClient`, `OutboundFeignAdapter`, `OutboundPortInterface`) en lugar
  de crear `External*` paralelos. Esto garantiza que las features de fase 5
  (`@CircuitBreaker`, `@Retry`, fallback, interceptors de auth) se aplican
  uniformemente a ambas familias. Se evaluó `@HttpExchange` y se descartó:
  Feign ya está integrado con Resilience4j vía `spring-cloud-starter-openfeign`
  y permite inyectar `RequestInterceptor`s sin código extra.

### 7.3 Fase 2 — Outbox transaccional + idempotencia

- **Cierra**: G4, G5, A7, A8.
- **Schema**: `infrastructure.reliability: { outbox, consumerIdempotency }` (default `false`).
- **Entregables**: módulo `shared/infrastructure/outbox/` (entidad JPA + repo +
  `OutboxPublisher` con `@Scheduled` + Flyway `V__outbox.sql`); módulo
  `shared/infrastructure/idempotency/` (`ProcessedEventJpa`, `IdempotencyGuard`).
- **Reescrituras**: `DomainEventHandler` cambia a escritura en outbox; `RabbitListener`
  / `KafkaListener` envuelven dispatch en `IdempotencyGuard.runOnce(...)`.

### 7.4 Fase 3 — Local Read Model (proyecciones persistentes)

- **Cierra**: G10, D2, D3, D4.
- **Schema**: `projections[].persistent: true` + `source: { kind: event, event, from }`
  + `keyBy` + `upsertStrategy: lastWriteWins | versionGuarded`.
- **Entregables**: JPA + `JpaRepository` + `ProjectionUpdaterEventHandler` + Flyway
  por proyección; el updater consume el evento del BC origen y hace upsert.
- **Validaciones**: INT-010 (evento publicado por el `from`), INT-011 (consumidor declarado).

### 7.5 Fase 4 — Sagas coreografiadas

- **Cierra parcialmente**: G1 (sólo choreography), C2, C6.
- **Schema**: `system.sagas[].style: choreography`; cada `step` declara `triggeredBy`,
  `onSuccess`, `onFailure`, `compensation`.
- **Entregables**: anotación `@SagaStep` (`shared/domain/annotations/SagaStep.java`),
  `CorrelationContext` (ThreadLocal + MDC), constantes `<Saga>SagaSteps.java`.
  Los handlers existentes (`DomainEventHandler`, `RabbitListener`, `KafkaListener`)
  se decoran con `@SagaStep` cuando el evento pertenece a un step y propagan
  `correlationId` end-to-end.
- **Validaciones**: INT-012, INT-013, INT-014.
- **Pendiente** (fase 8): orquestación con `saga_instance` persistente, timeouts a
  nivel saga (C3, C4, C5).

### 7.6 Fase 5 — Resiliencia HTTP + autenticación

- **Cierra**: G7, G8, B5, B6, B7.
- **Schema**: `*.resilience: { timeoutMs, connectTimeoutMs, retries, circuitBreaker }`
  y `*.auth: { type, ... }` aceptados en `system.integrations[]`,
  `system.externalSystems[]` y `bc.integrations.outbound[]` (precedencia bc → system).
- **Entregables**:
  - [`src/utils/resilience-auth-resolver.js`](../src/utils/resilience-auth-resolver.js)
    con resolución y precedencia.
  - Reescritura de `OutboundFeignAdapter` (`@CircuitBreaker` + `@Retry` + método
    `*Fallback` privado con `// TODO`), `OutboundFeignConfig` y `ExternalRestConfig`
    (api-key/bearer inline; oauth2-cc por inyección de
    `OAuth2ClientCredentialsSupport`).
  - Helper compartido `shared/infrastructure/auth/OAuth2ClientCredentialsSupport.java`
    que resuelve tokens vía `OAuth2AuthorizedClientManager`.
  - `parameters/{env}/resilience.yaml` con bloque `default` Resilience4j (CB+retry).
  - `build.gradle` añade condicionalmente `spring-cloud-starter-circuitbreaker-resilience4j`,
    `resilience4j-spring-boot3` y `spring-boot-starter-oauth2-client`.
- **Validación**: INT-015 (`auth.type: oauth2-cc` requiere `tokenEndpoint`+`credentialKey`).
- **Decisión técnica**: no se generó `@TimeLimiter` para no forzar `CompletableFuture`
  en clientes Feign sincrónicos; los timeouts se aplican vía `Request.Options`.

### 7.7 Cobertura tras fases 0–5

La tabla §3 se actualiza así para los escenarios afectados:

| # | Escenario | Antes | Tras 0–5 |
|---|-----------|-------|----------|
| A7 | Outbox transaccional | 🟡 | ✅ |
| A8 | Idempotencia consumidor | ❌ | ✅ |
| B4 | Cliente HTTP a sistema externo | ❌ | ✅ |
| B5 | Circuit breaker + fallback | ❌ | ✅ |
| B6 | Timeouts/retry HTTP por integración | 🟡 | ✅ |
| B7 | mTLS / API-key / OAuth2 por integración | ❌ | ✅ (api-key, bearer, oauth2-cc; mTLS placeholder) |
| C1 | Choreography manual (handler por evento) | 🟡 | ✅ (decorado con `@SagaStep`) |
| C2 | correlationId end-to-end | ❌ | ✅ |
| C6 | Eventos de compensación marcados | 🟡 | ✅ (`compensation:` declarado en step) |
| D2 | Projection materializada por evento | ❌ | ✅ |
| D4 | Repositorio dedicado a la projection | ❌ | ✅ |
| E1 | `pattern: acl` con `channel: http` | ❌ | ✅ |

### 7.8 Gaps que permanecen abiertos

Fuera del alcance de las fases 0–5 (ver `Out of scope` en
`/memories/session/plan.md`):

- **G6** — versionado de eventos (fase 6).
- **G9** — webhooks entrantes + firma HMAC (fase 7).
- **C3–C5** — sagas orquestadas con persistencia y timeouts (fase 8).
- **G13** — multi-broker simultáneo (fase 9).
- **G11** — `isolationStrategy: schema-per-bc` reflejado en `@Table(schema=…)` y Flyway por schema (sin fase asignada).
- **G14** — distinción entre comando asincrónico y evento de dominio (sin fase asignada).
- **A9–A16, B8–B11, F1–F5** — escenarios de mensajería avanzada, transportes alternativos
  (gRPC/GraphQL/WebClient), multi-tenant y observabilidad de DLQ.

La documentación de uso de las features entregadas vive en
[docs/integrations-new-features.md](../docs/integrations-new-features.md) con
ejemplos por caso de uso (BC interno con api-key, sistema externo con OAuth2,
saga + outbox + idempotencia, LRM cross-BC).
