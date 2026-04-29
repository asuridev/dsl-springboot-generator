# Análisis profundo — Sección `integrations` vs. código generado

> Fecha: 2026-04-29
> Diseño analizado: `C:\Users\antonio.suarez\Desktop\test-dsl\arch`
> Código generado: `C:\Users\antonio.suarez\Desktop\test-dsl\src`
> Generador: `dsl-springboot-generator` (workspace actual)
>
> **Objetivo**: evaluar la robustez del generador frente a la sección `integrations`
> del `system.yaml` y la sección `integrations` + `domainEvents` de cada `{bc}.yaml`,
> e identificar gaps que limitan la cobertura de escenarios reales.

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
| A7 | **Outbox pattern transaccional con tabla y poller** | 🟡 | Hoy solo `@TransactionalEventListener(AFTER_COMMIT)` — si el broker está caído tras el commit, el evento se pierde |
| A8 | **Idempotencia del consumidor** (event id store) | ❌ | El consumer puede reentregar; no hay de-dup |
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
| B4 | **Cliente HTTP a sistema externo** (`pattern: acl`, externalSystem) | ❌ | `outbound-http-generator.js` salta si no encuentra `arch/<target>/<target>-internal-api.yaml`; no hay catálogo de stubs/contratos para externos |
| B5 | **Circuit breaker / fallback** (Resilience4j) | ❌ | No se genera `@CircuitBreaker`, ni `fallbackMethod`, ni el `application.yaml` con la config |
| B6 | **Timeouts / retry HTTP por integración** | 🟡 | Solo el default del cliente Feign; no se parametriza en YAML |
| B7 | **mTLS / API-key / OAuth2 client-credentials** por integración | ❌ | Sin sección `auth:` en `integrations.outbound` |
| B8 | **Versionado del contrato cliente** (`/v1`, `/v2` simultáneos) | 🟡 | Versionado URL OK; coexistencia v1+v2 cliente requiere duplicar manualmente |
| B9 | **GraphQL / gRPC / SOAP** para clientes salientes | ❌ | Solo REST/Feign |
| B10 | **WebClient/RestClient reactivo** como alternativa a Feign | ❌ | Forzado a Feign |
| B11 | **Soporte de paginación / `Pageable` en endpoints internos** | 🟡 | El mediator dispatcha Query como POST; no genera `?page&size` automáticamente |

### 3.3 Sagas y orquestación

| # | Escenario | Estado | Evidencia |
|---|-----------|--------|-----------|
| C1 | Choreography manual (handler por evento) | 🟡 | Soportado solo porque el listener despacha al UseCaseMediator; el desarrollador escribe el cuerpo |
| C2 | **Generar correlationId / sagaId end-to-end** | ❌ | `EventEnvelope` lleva `correlationId` pero no hay propagación al iniciar el flujo desde controller |
| C3 | **`sagas[]` del `system.yaml` se materializa** (orchestrator + steps + compensations) | ❌ | grep `saga` en `src/` → 0 matches; el bloque YAML se ignora |
| C4 | **Process manager / orquestador con persistencia de estado** | ❌ | Sin tabla `saga_instance`, sin máquina de estados |
| C5 | **Timeouts y reintentos a nivel saga** (paso colgado) | ❌ | No hay scheduler ni alarms |
| C6 | **Eventos de compensación generados** (e.g. `StockReleased`) | 🟡 | El evento es un `domainEvent` cualquiera; no hay marca de “compensa a X” |

### 3.4 Local Read Model / Projections

| # | Escenario | Estado | Evidencia |
|---|-----------|--------|-----------|
| D1 | Projection como DTO de respuesta | ✅ | `Projection.java.ejs` genera `record` |
| D2 | **Projection materializada por evento** (tabla + listener que pobla) | ❌ | El generador trata projections como DTO de salida del query, no como read model alimentado por eventos (`customers → orders / CustomerAddressSnapshot`) |
| D3 | **Reposición histórica (replay) de la projection** | ❌ | Sin endpoint de replay ni cursor de offset |
| D4 | **Repositorio dedicado a la projection** (`@Repository` Jpa) | ❌ | No hay template específico |
| D5 | **CDC / Debezium** como alternativa a eventos de dominio | ❌ | Fuera del alcance del generador hoy |

### 3.5 ACL e integraciones externas

| # | Escenario | Estado | Evidencia |
|---|-----------|--------|-----------|
| E1 | `pattern: acl` con `channel: http` (payment-gateway, email-provider, sms-provider) | ❌ | No se materializa adaptador HTTP, ni mapper, ni port — el generador solo escribe la URL en `urls.yaml` |
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

| ID | Gap | Impacto | Severidad |
|----|-----|---------|-----------|
| G0 | **Triple fuente de verdad sin validación cruzada**: `system.yaml/integrations` ↔ `{bc}.yaml/integrations.outbound|inbound` ↔ `{bc}.yaml/domainEvents.published|consumed`. Un evento declarado en `system.yaml` pero no en `domainEvents.published` se ignora silenciosamente. | Drift entre estratégico y táctico → contratos imaginarios. | 🔴 Alto |
| G1 | El bloque `sagas[]` de `system.yaml` no se procesa (no hay generador). | Diseño expresado pero invisible al codigo. | 🔴 Alto |
| G2 | `externalSystems[]` no se procesa (no hay adaptador, port ni mapper). | Cada integración ACL se implementa a mano → riesgo OWASP A04 / A09. | 🔴 Alto |
| G3 | No existe `pattern: acl` / `type: externalSystem` en `integrations.outbound` del BC. | El generador no tiene punto de extensión para ACL externo aún si se quisiera invocar. | 🔴 Alto |
| G4 | Ausencia de outbox real (solo `AFTER_COMMIT`). | Pérdida silenciosa de eventos si el broker falla post-commit. | 🟠 Medio |
| G5 | Sin idempotencia de consumidor. | Reentregas → efectos duplicados (cobros, stock, notificaciones). | 🟠 Medio |
| G6 | Sin versionado de evento (`eventVersion`, content-type). | Schema evolution rompe consumidores. | 🟠 Medio |
| G7 | Sin scaffolding de resiliencia HTTP (CB, retry, timeout, bulkhead) por integración. | Cascadas de fallos. | 🟠 Medio |
| G8 | Sin metadatos de seguridad por integración (`auth: { type: oauth2-cc/api-key/mTLS }`). | Configuración manual y propensa a olvidos. | 🟠 Medio |
| G9 | Sin webhook entrante ni firma HMAC. | Casos comunes (gateways, proveedores) requieren código manual. | 🟡 Bajo-Medio |
| G10 | Sin replay/projection updater (LRM). | El patrón LRM declarado en `system.yaml` (customers→orders) no se concreta. | 🟠 Medio |
| G11 | `infrastructure.database.isolationStrategy` y `deployment.strategy` son “documento”, no se reflejan en código. | Diseño no operativo. | 🟡 Bajo |
| G12 | El `channel:` del evento (e.g. `catalog.product.activated`) en `system.yaml` no se compara con la routing key derivada (`kebab(eventName)`). Si el diseñador pone un canal “raro” se ignora. | Drift documentación ↔ runtime. | 🟡 Bajo |
| G13 | El generador asume un único broker (`infrastructure.messageBroker: true` + `config.broker`). Sistemas reales coexisten Kafka (eventos de negocio) + Rabbit (comandos) + SQS. | No soportado. | 🟡 Bajo |
| G14 | No hay distinción entre **comando asincrónico** y **evento de dominio**. Toda integración asíncrona se modela como evento publicado/consumido. | Patrones request-reply async no expresables. | 🟡 Bajo |
| G15 | El bloque `notes` de cada integración (LRM trade-offs, OWASP A04) es referencia humana — el generador no exige ni emite comentarios `// derived_from: notes` en el código resultante. | Trazabilidad incompleta. | 🟢 Bajo |

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

## 6. Conclusión

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
