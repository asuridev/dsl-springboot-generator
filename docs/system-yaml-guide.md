# Guía de `system.yaml` — Diseño Estratégico (Paso 1)

`system.yaml` es la **fuente de verdad del sistema completo**. Lo genera el agente
`design-system` durante el Paso 1 y lo consume el Paso 2 como punto de partida para
cada Bounded Context. Es technology-agnostic: no menciona frameworks, librerías ni
decisiones de implementación.

---

## Estructura general

El archivo tiene **cinco secciones** en este orden fijo:

```
system          → identidad del sistema
boundedContexts → BCs con agregados estratégicos
externalSystems → sistemas externos referenciados en integraciones
integrations    → mapa de comunicaciones
infrastructure  → restricciones de deployment y datos
```

Opcionalmente incluye una sexta sección:

```
sagas           → procesos de negocio que cruzan 3+ BCs
```

---

## `system` — Identidad del sistema

```yaml
system:
  name: ecommerce-platform
  description: >
    Multi-tenant B2C ecommerce platform for physical product sales.
    Supports catalog management, order lifecycle, and third-party payment processing.
  domainType: core
```

| Campo | Tipo | Descripción |
|---|---|---|
| `name` | kebab-case | Identificador del sistema. Usado como prefijo en rutas y configuraciones. |
| `description` | texto libre | Propósito del sistema en 2–4 oraciones. En inglés. |
| `domainType` | `core` \| `supporting` \| `generic` | Clasificación DDD del sistema completo. En general siempre `core`. |

**Por qué importa `domainType`:** define cuánta inversión de diseño merece el sistema.
Un sistema `core` es la ventaja competitiva del negocio. Un sistema `generic` es commodity
que podría reemplazarse con un SaaS.

---

## `boundedContexts` — Mapa de Bounded Contexts

Cada BC es un límite conceptual con lenguaje propio y responsabilidad clara. En el Paso 1
se captura solo el nivel estratégico: propósito y agregados. Los detalles tácticos van en
el Paso 2.

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
```

### Campos de un BC

| Campo | Tipo | Descripción |
|---|---|---|
| `name` | kebab-case | Identificador del BC. Se usa como nombre de carpeta en `arch/`. |
| `type` | `core` \| `supporting` \| `generic` | Clasificación DDD del BC. |
| `purpose` | texto | Una frase: qué hace este BC y por qué existe. |
| `aggregates` | lista | Agregados estratégicos del BC. |

### Campos de un agregado (nivel estratégico)

| Campo | Tipo | Descripción |
|---|---|---|
| `name` | PascalCase | Nombre del agregado. |
| `root` | PascalCase | Entidad raíz (Aggregate Root). Casi siempre igual a `name`. |
| `entities` | lista de PascalCase | Entidades internas relevantes (máx. 4). Sin Value Objects ni Domain Events — eso es Paso 2. |

### Tipos de BC

| Tipo | Significado | Ejemplo |
|---|---|---|
| `core` | Ventaja competitiva del negocio | `catalog`, `orders`, `dispatch` |
| `supporting` | Necesario para el core, sin diferenciación | `inventory`, `notifications`, `invoicing` |
| `generic` | Resuelto con 3rd party o librería estándar | `auth`, `payments` con pasarela externa |

> **Señal de sobre-diseño:** si un BC tiene más de 5 agregados, probablemente esconde dos BCs.
> **Señal de sub-diseño:** si tiene cero agregados, probablemente es una entidad dentro de otro BC.

---

## `externalSystems` — Sistemas externos

Solo se declaran los sistemas que aparecen referenciados en `integrations`. No declarar
sistemas externos que no tienen ninguna integración definida.

```yaml
externalSystems:

  - name: payment-gateway
    description: >
      Third-party payment processor that handles card charging and refunds.
    type: payment-gateway

  - name: sms-provider
    description: >
      SMS delivery service for customer notifications via mobile.
    type: notification-provider
```

### Campos

| Campo | Tipo | Descripción |
|---|---|---|
| `name` | kebab-case | Debe coincidir exactamente con los valores `from`/`to` en `integrations`. |
| `description` | texto | Qué hace este sistema externo. |
| `type` | enum | Clasificación del sistema externo. |

### Valores válidos de `type`

`payment-gateway` · `notification-provider` · `identity-provider` · `erp` · `logistics`
· `tax-authority` · `crm` · `analytics` · `storage` · `other`

---

## `integrations` — Mapa de comunicaciones

Es la sección más importante del Paso 1. Cada entrada describe **una dirección** de
comunicación entre dos partes (BC→BC, BC→externo, o externo→BC). Separar de los BCs
permite que el mapa de integraciones evolucione sin modificar los BC.

```yaml
integrations:

  # Integración sincrónica HTTP
  - from: orders
    to: catalog
    pattern: customer-supplier
    channel: http
    contracts:
      - validateProductsAndPrices
    notes: >
      orders validates product existence and snapshots unit prices from catalog
      at order placement. Price is always read from catalog, never from the request.

  # Integración asíncrona por eventos
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
      inventory reacts to product lifecycle events to create or close StockItems.

  # Integración con sistema externo (siempre ACL)
  - from: payments
    to: payment-gateway
    pattern: acl
    channel: http
    contracts:
      - chargeCard
      - refundCharge
    notes: >
      ACL isolates the domain from the payment gateway's model.
      The domain never knows the gateway's DTOs.
```

### Campos de una integración

| Campo | Tipo | Descripción |
|---|---|---|
| `from` | nombre de BC o external system | Emisor / llamante. |
| `to` | nombre de BC o external system | Receptor / proveedor. |
| `pattern` | enum | Patrón de relación entre los dos lados. |
| `channel` | enum | Mecanismo de transporte. |
| `contracts` | lista | Operaciones (HTTP) o eventos (message-broker) del contrato. |
| `notes` | texto | Por qué existe esta integración y decisiones de diseño relevantes. |

### Patrones válidos

| Patrón | Cuándo usarlo |
|---|---|
| `customer-supplier` | Un BC depende del modelo de otro; el supplier dicta el contrato. |
| `event` | Comunicación asíncrona vía eventos de dominio. |
| `acl` | Siempre en integraciones con sistemas externos. Protege el dominio del modelo externo. |
| `shared-kernel` | Dos BCs comparten código (usar con precaución). |
| `open-host` | Un BC expone una API estable que otros consumen libremente. |

### Canales válidos

| Valor | Qué significa |
|---|---|
| `http` | El BC llamante hace una petición REST síncrona al BC proveedor y espera la respuesta antes de continuar. Es el canal más común entre BCs internos. |
| `grpc` | Igual que `http` pero usando Protocol Buffers en lugar de JSON. Preferir cuando el volumen o la latencia es crítica. |
| `websocket` | El BC proveedor envía actualizaciones en tiempo real al BC llamante sin que éste tenga que volver a preguntar. Canal de uso poco frecuente. |
| `message-broker` | Comunicación asíncrona. El BC emisor publica un evento en el broker y no espera respuesta; el BC receptor lo procesa cuando puede. |

### Formato de `contracts[]`

El formato depende del valor de `channel`. La pregunta clave es: **¿qué información cruza la frontera?**

---

**`channel: http | grpc | websocket`** → el contrato son **endpoints del BC `to`** (el proveedor)

Cada string en camelCase es el nombre de un endpoint que **pertenece al BC `to`** y que el BC `from` va a consumir. No es un evento ni un use case — es el nombre funcional del endpoint tal como aparecerá en el `operationId` del OpenAPI del BC proveedor. El BC `from` no genera ningún endpoint por esta entrada — solo genera el cliente HTTP que lo consume.

```yaml
- from: orders        # ← llamante (genera el cliente HTTP)
  to: catalog         # ← proveedor (genera el endpoint)
  channel: http
  pattern: customer-supplier
  contracts:
    - validateProductsAndPrices   # endpoint de catalog — orders lo invoca al confirmar un pedido
    - getProductById              # endpoint de catalog — orders lo invoca para obtener detalle

- from: orders        # ← llamante
  to: customers       # ← proveedor (genera el endpoint)
  channel: http
  pattern: customer-supplier
  contracts:
    - getCustomerAddress          # endpoint de customers — orders lo invoca para obtener la
                                  # dirección de envío del cliente
```

> Estos strings en el `system.yaml` se convierten en `operationId` en el **OpenAPI del BC `to`**
> durante el Paso 2. Si la integración declara `validateProductsAndPrices`, entonces
> `catalog-open-api.yaml` debe tener `operationId: validateProductsAndPrices`.

---

**`channel: message-broker`** → el contrato son **nombres de eventos** (mensajes asíncronos)

Cada objeto identifica un evento de dominio que cruza la frontera. `name` es el nombre del evento en PascalCase; `channel` es el nombre del canal tal como aparecerá en el AsyncAPI.

```yaml
- from: orders
  to: inventory
  channel: message-broker
  pattern: event
  contracts:
    - name: OrderConfirmed             # orders publica este evento…
      channel: orders.order.confirmed  # …en este canal del broker
    - name: OrderCancelled
      channel: orders.order.cancelled
```

> El valor de `channel` en cada contrato de mensaje será copiado literalmente al archivo
> `{bc-name}-async-api.yaml` en el Paso 2. Cualquier discrepancia rompe la trazabilidad.

---

**Resumen visual:**

| `channel` | Elemento en `contracts[]` | Tipo | Ejemplo |
|---|---|---|---|
| `http` | Nombre de operación REST | string camelCase | `validateProductsAndPrices` |
| `grpc` | Nombre de método RPC | string camelCase | `getCustomerProfile` |
| `websocket` | Nombre de stream | string camelCase | `subscribeToOrderUpdates` |
| `message-broker` | Evento de dominio | objeto `{name, channel}` | `{name: OrderConfirmed, channel: orders.order.confirmed}` |

### Árbol de decisión para elegir patrón y canal

```
¿La respuesta inmediata es necesaria para continuar el flujo?
  ├── Sí  → channel: http,           pattern: customer-supplier
  └── No  → channel: message-broker, pattern: event

¿Se integra con un sistema externo?
  └── Siempre → pattern: acl  (independiente del channel)
```

---

## `sagas` — Procesos de negocio transversales (opcional)

Se declara cuando existe una cadena de 3+ BCs conectados por eventos que forma una unidad
de trabajo con nombre en el negocio — si algún paso falla, los pasos anteriores deben
compensarse.

```yaml
sagas:
  - name: CheckoutSaga
    description: >
      Coordinates the full checkout process: order confirmation, payment capture,
      and stock reservation. Any step failure triggers upstream compensation.
    trigger:
      event: OrderPlaced
      bc: orders
    steps:
      - order: 1
        bc: payments
        triggeredBy: OrderPlaced
        onSuccess: PaymentCaptured
        onFailure: PaymentFailed
        compensation: PaymentRefunded

      - order: 2
        bc: inventory
        triggeredBy: PaymentCaptured
        onSuccess: StockReserved
        onFailure: StockReservationFailed
        compensation: StockReleased
```

### Campos de un saga

| Campo | Descripción |
|---|---|
| `name` | PascalCase + Saga. Nombre del proceso de negocio. |
| `description` | Qué coordina este saga y cuándo se activa la compensación. |
| `trigger.event` | Evento que inicia el saga (PascalCase). |
| `trigger.bc` | BC que publica el evento disparador. |
| `steps[].order` | Posición en la cadena (1, 2, 3…). |
| `steps[].bc` | BC que ejecuta este paso. |
| `steps[].triggeredBy` | Evento que activa este paso (PascalCase). |
| `steps[].onSuccess` | Evento emitido si el paso tiene éxito. |
| `steps[].onFailure` | Evento emitido si el paso falla (opcional). |
| `steps[].compensation` | Evento que deshace este paso si un paso posterior falla (opcional). |

> Cada evento declarado en `onSuccess`, `onFailure` y `compensation` **debe existir**
> como contrato en la integración `pattern: event` del BC emisor en `integrations[]`.

---

## `infrastructure` — Restricciones de deployment y datos

Siempre presente. Declara las decisiones estructurales que afectan a todos los BCs.
La tecnología concreta (qué motor de base de datos, qué broker) es decisión del generador
de código en la Fase 2, no del diseño.

```yaml
infrastructure:

  deployment:
    strategy: modular-monolith
    architectureStyle: hexagonal
    notes: >
      Default applied. Modular monolith enables fast V1 delivery while preserving
      the ability to extract BCs as microservices later without touching domain code.

  messageBroker: true

  database:
    type: relational
    isolationStrategy: schema-per-bc
    notes: >
      Default applied. schema-per-bc aligns with modular-monolith and allows
      future migration to db-per-bc when moving to microservices.
```

### `deployment`

| Campo | Valores válidos | Default | Descripción |
|---|---|---|---|
| `strategy` | `modular-monolith` \| `microservices` \| `serverless` | `modular-monolith` | Cómo se despliegan los BCs. |
| `architectureStyle` | `hexagonal` \| `layered` \| `clean` | `hexagonal` | Patrón de organización interna de cada BC. |
| `notes` | texto | — | Explicar si es default o decisión explícita y el motivo. |

### `messageBroker`

```yaml
messageBroker: true   # presente si hay al menos una integración con channel: message-broker
                      # omitir si no hay ninguna
```

No se declara la tecnología concreta (RabbitMQ, Kafka, etc.) — eso lo decide el generador.

### `database`

| Campo | Valores válidos | Default | Descripción |
|---|---|---|---|
| `type` | `relational` \| `document` \| `key-value` \| `graph` | `relational` | Tipo de base de datos. La tecnología concreta la elige el generador. |
| `isolationStrategy` | `schema-per-bc` \| `db-per-bc` \| `prefix-per-bc` | `schema-per-bc` | Cómo se aíslan los datos de cada BC. |
| `notes` | texto | — | Explicar si es default o decisión explícita. |

**Guía para elegir `isolationStrategy`:**

| Estrategia | Cuándo usarla |
|---|---|
| `schema-per-bc` | Monolito modular. Un schema SQL por BC. Recomendado para V1. |
| `db-per-bc` | Microservicios. Base de datos completamente separada por BC. |
| `prefix-per-bc` | Monolito simple. Tablas con prefijo del BC en una sola DB. Útil para proyectos pequeños. |

---

## Reglas de validación rápida

Antes de considerar el `system.yaml` completo, verificar:

- [ ] Todo `from`/`to` en `integrations` existe como nombre en `boundedContexts` o `externalSystems`
- [ ] Si hay `channel: message-broker`, existe `infrastructure.messageBroker: true`
- [ ] Los contratos de `message-broker` son objetos `{name, channel}`, no strings
- [ ] Los contratos de `http/grpc` son strings en camelCase, no objetos
- [ ] Todo sistema en `externalSystems` aparece en al menos una integración
- [ ] Todo evento en `sagas[].steps[].onSuccess/onFailure/compensation` existe como contrato de integración

---

## Ejemplo mínimo completo

```yaml
system:
  name: catalog-service
  description: >
    Product catalog management system for a B2C ecommerce platform.
  domainType: core

boundedContexts:

  - name: catalog
    type: core
    purpose: >
      Manages product and category lifecycle from creation to discontinuation.
    aggregates:
      - name: Product
        root: Product
        entities:
          - ProductImage
      - name: Category
        root: Category
        entities: []

  - name: inventory
    type: supporting
    purpose: >
      Tracks real-time stock availability for each active product.
    aggregates:
      - name: StockItem
        root: StockItem
        entities: []

externalSystems: []

integrations:

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
      inventory creates or closes StockItems in reaction to product lifecycle events.

infrastructure:

  deployment:
    strategy: modular-monolith
    architectureStyle: hexagonal
    notes: Default applied.

  messageBroker: true

  database:
    type: relational
    isolationStrategy: schema-per-bc
    notes: Default applied.
```
