# Guía de `{bc-name}.yaml` — Diseño Táctico (Paso 2)

`{bc-name}.yaml` es la **fuente de verdad táctica de un Bounded Context**. Lo genera el
agente `design-bounded-context` durante el Paso 2. Es el input principal que un generador
de código consume para producir entidades, repositorios, use cases, APIs y esquemas de base
de datos. Como el `system.yaml`, es technology-agnostic: no menciona frameworks ni librerías.

El archivo se ubica en `arch/{bc-name}/{bc-name}.yaml`.

---

## Estructura general

Las secciones aparecen siempre en este orden:

```
bc              → identificador del BC
type            → clasificación DDD
description     → propósito del BC
enums           → tipos con valores cerrados (estados, clasificaciones)
valueObjects    → tipos de valor compuestos
aggregates      → modelo del dominio (entidades, reglas, propiedades)
useCases        → operaciones que el BC expone o reacciona
repositories    → contratos de acceso a datos
errors          → catálogo de errores del dominio
integrations    → dependencias del BC hacia afuera y hacia adentro
domainEvents    → eventos publicados y consumidos
```

---

## Cabecera del BC

```yaml
bc: catalog
type: core
description: >
  Manages the lifecycle of products and categories, from initial draft creation
  through activation, price changes, and final discontinuation.
```

| Campo | Tipo | Descripción |
|---|---|---|
| `bc` | kebab-case | Debe coincidir exactamente con el `name` del BC en `system.yaml`. |
| `type` | `core` \| `supporting` \| `generic` | Clasificación DDD, igual a la declarada en `system.yaml`. |
| `description` | texto (inglés) | 1–2 oraciones. Derivar del campo `purpose` de `system.yaml`. |

---

## `enums` — Tipos enumerados

Hay dos clases de enums:

### Enum de ciclo de vida (estados)

Modela las transiciones válidas de un agregado. Cada valor de estado declara las
transiciones posibles, qué las dispara y qué evento emite.

```yaml
enums:

  - name: ProductStatus
    description: Lifecycle states of a Product aggregate.
    values:
      - value: DRAFT
        description: Product is being prepared, not yet visible to customers.
        transitions:
          - to: ACTIVE
            triggeredBy: UC-PRD-004 ActivateProduct
            condition: PRD-RULE-001             # gate: bloquea la transición si no se cumple
            rules: [PRD-RULE-001, PRD-RULE-002]  # todas las reglas evaluadas en el UC
            emits: ProductActivated
          - to: DISCONTINUED
            triggeredBy: UC-PRD-005 DiscontinueProduct
            condition: none
            rules: []
            emits: ProductDiscontinued

      - value: ACTIVE
        description: Product is live and available for purchase.
        transitions:
          - to: DISCONTINUED
            triggeredBy: UC-PRD-005 DiscontinueProduct
            condition: none
            rules: []
            emits: ProductDiscontinued

      - value: DISCONTINUED
        description: Product is permanently retired. No further transitions.
        transitions: []   # estado terminal — sin salidas
```

**Campos de una transición:**

| Campo | Tipo | Descripción |
|---|---|---|
| `to` | SCREAMING_SNAKE | Estado destino. |
| `triggeredBy` | `UC-ID NombreUC` | Use case que dispara la transición. |
| `condition` | `RULE-ID` o `none` | La regla que actúa como **puerta de entrada**: si no se cumple, la transición falla y se lanza el `errorCode` de esa regla. Siempre un ID o `none`, nunca texto libre. |
| `rules` | lista de RULE-ID | **Todas** las reglas evaluadas durante la ejecución del use case para esta transición. Incluye la `condition` más cualquier regla adicional (`sideEffect`, `uniqueness`, etc.). Omitir si vacío. |
| `emits` | PascalCase o `null` | Evento de dominio emitido al completar la transición. |

> **`condition` vs `rules`:** `condition` es la única regla que actúa como puerta de entrada — bloquea la transición si no se cumple. `rules` es el conjunto completo evaluado durante el use case: puede coincidir con `condition` cuando hay una sola regla, o ser un superconjunto cuando hay varias. En el ejemplo de arriba: `PRD-RULE-001` es el gate (¿puede activarse el producto?); `PRD-RULE-002` también se evalúa en el mismo use case (unicidad de SKU) pero no es el gate de la transición.

### Enum de clasificación simple

Sin ciclo de vida — solo un conjunto cerrado de valores.

```yaml
  - name: ImageType
    description: Classification of product image by its role.
    values:
      - value: MAIN
        description: Primary product image shown in listings.
      - value: GALLERY
        description: Additional image shown in the product detail gallery.
      - value: THUMBNAIL
        description: Small format image for compact views.
```

---

## `valueObjects` — Objetos de valor

Un Value Object es un tipo compuesto definido por sus propiedades, sin identidad propia.
Ejemplos canónicos: `Money`, `Slug`, `ShippingAddress`, `DateRange`.

```yaml
valueObjects:

  - name: Money
    description: >
      Represents an exact monetary amount with its currency.
      Modeled as a VO to guarantee that amount and currency always travel together
      and that precision is never lost through floating-point representation.
    properties:
      - name: amount
        type: Decimal
        precision: 19
        scale: 4
        required: true
        description: Exact monetary amount as a decimal string.
      - name: currency
        type: String(3)
        required: true
        description: ISO 4217 currency code (e.g. COP, USD, EUR).
```

### Tipos canónicos disponibles para propiedades

| Tipo | Descripción | Notas |
|---|---|---|
| `Uuid` | Identificador único | Siempre para campos `id` y referencias. |
| `String` | Texto sin límite | Usar solo si la longitud es realmente desconocida. |
| `String(n)` | Texto con máximo n caracteres | Preferir sobre `String` cuando se conoce el límite. |
| `Text` | Texto largo | Descripciones, contenido HTML, notas. |
| `Integer` | Entero 32 bits | Cantidades, contadores. |
| `Long` | Entero 64 bits | Contadores muy grandes, timestamps Unix. |
| `Decimal` | Decimal de precisión exacta | Siempre usar con `precision` y `scale`. |
| `Boolean` | Verdadero / falso | |
| `Date` | Fecha sin hora | Fecha de nacimiento, vencimiento. |
| `DateTime` | Fecha y hora UTC | Timestamps de eventos y auditoría. |
| `Email` | Email validado | Genera validación automática. |
| `Url` | URL absoluta validada | |
| `Money` | VO monetario | Siempre declarar como Value Object, no como primitivo. |

---

## `aggregates` — Modelo del dominio

El núcleo del archivo. Cada agregado es una unidad de consistencia con su raíz, propiedades,
entidades internas, reglas de negocio y — opcionalmente — sus flags especiales.

```yaml
aggregates:

  - name: Product
    root: Product
    auditable: true
    description: >
      Central entity of the catalog BC. Represents a sellable item with its
      commercial information and lifecycle status. Its invariant is that price
      and category are always valid before activation.
```

### Flags del agregado

| Flag | Descripción |
|---|---|
| `auditable: true` | El generador inyecta `createdAt` y `updatedAt` automáticamente. No declararlos como propiedades. |
| `softDelete: true` | Borrado lógico. El generador inyecta `deletedAt` (nullable). Todos los `findAll` filtran `deletedAt IS NULL`. El endpoint DELETE mapea a `softDelete(id)`. |
| `readModel: true` | Agregado de proyección local (Local Read Model). Alimentado por eventos de otro BC. El generador no genera endpoints de escritura. Requiere `sourceBC` y `sourceEvents`. |

### Propiedades

```yaml
    properties:
      - name: id
        type: Uuid
        required: true
        description: Unique identifier of the product.

      - name: name
        type: String(200)
        required: true
        description: Commercial name of the product.

      - name: sku
        type: String(100)
        required: true
        unique: true          # genera índice UNIQUE en DB
        description: Stock-keeping unit code. Unique across the catalog.

      - name: status
        type: ProductStatus   # referencia al enum declarado arriba
        required: true
        readOnly: true
        defaultValue: DRAFT   # valor inicial en la factory del agregado

      - name: categoryId
        type: Uuid
        required: true
        references: Category
        relationship: association
        cardinality: manyToOne
        description: Reference to the category this product belongs to.

      - name: price
        type: Money           # referencia al Value Object
        required: true
        description: Current selling price of the product.

      - name: slug
        type: String(200)
        required: true
        readOnly: true
        description: URL-friendly identifier derived from the name. Computed server-side.
```

**Campos de una propiedad:**

| Campo | Descripción |
|---|---|
| `name` | camelCase. |
| `type` | Tipo canónico, enum propio, o Value Object. |
| `required` | `true` \| `false`. |
| `unique` | `true` → índice UNIQUE en DB y método `findBy{Campo}` en el repositorio. |
| `indexed` | `true` → índice no-unique en DB (para campos de búsqueda frecuente). |
| `references` | Nombre del agregado referenciado (para asociaciones). |
| `relationship` | `association` (referencia por ID, sin embeber). |
| `cardinality` | `manyToOne` \| `oneToOne`. |
| `bc` | BC propietario del agregado referenciado (solo en asociaciones cross-BC). |

### Flags de visibilidad de propiedades

| Flag | Significado | Caso de uso |
|---|---|---|
| `readOnly: true` | Server-generated. Excluida de requests, incluida en responses y DB. Requiere `defaultValue` o `source`. | `status`, `slug`, `createdBy` |
| `hidden: true` | Write-only. Incluida en requests, excluida de responses. Persiste en DB. | `password`, `pin`, tokens secretos |
| `internal: true` | Solo en DB. Excluida de requests y responses. | `attemptCount`, `retryCount`, flags internos |

**`defaultValue` para campos `readOnly`:**
- `defaultValue: DRAFT` → valor literal en la factory
- `defaultValue: now()` → `DateTime.now(UTC)` resuelto en el application service
- `source: authContext` → inyectado desde el contexto de autenticación

### Entidades internas (composición)

Las entidades solo existen dentro del agregado. Su ciclo de vida pertenece al root.

```yaml
    entities:
      - name: ProductImage
        relationship: composition
        cardinality: oneToMany
        description: Images associated with the product.
        properties:
          - name: id
            type: Uuid
            required: true
          - name: url
            type: Url
            required: true
          - name: type
            type: ImageType
            required: true
          - name: sortOrder
            type: Integer
            required: true
```

> **`immutable: true`** en una entidad indica que solo permite INSERT, no UPDATE ni DELETE.
> Útil para `PriceHistory`, `AuditLog`, `EventLog`.

### Reglas de dominio

Las invariantes que el sistema debe hacer cumplir siempre, independientemente del actor.

```yaml
    domainRules:
      - id: PRD-RULE-001
        type: statePrecondition
        errorCode: PRODUCT_NOT_ACTIVATABLE
        description: >
          A product can only be activated if it has a name, a valid price greater
          than zero, and at least one image.

      - id: PRD-RULE-002
        type: uniqueness
        errorCode: PRODUCT_SKU_ALREADY_EXISTS
        description: >
          SKU must be unique across all products in the catalog, regardless of status.

      - id: PRD-RULE-003
        type: deleteGuard
        errorCode: PRODUCT_CANNOT_BE_DELETED
        description: >
          A product can only be physically deleted if it is in DRAFT status.
```

**Tipos de regla:**

| Tipo | Qué genera el generador |
|---|---|
| `statePrecondition` | Guard en el método de dominio que verifica la condición antes de transicionar. |
| `uniqueness` | Índice UNIQUE en DB + método `findBy{Campo}` en el repositorio. |
| `terminalState` | Documenta que el estado no tiene salidas; sin método de transición. |
| `sideEffect` | Lógica adicional en el método de dominio (ej: registrar historial). |
| `deleteGuard` | Guard en el use case de delete + método `delete` en el repositorio. |
| `crossAggregateConstraint` | Método de query en el repositorio del otro agregado. |

---

## `useCases` — Operaciones del BC

Cada use case es una operación con nombre, actor, trigger, y comportamiento definido.

### Use case de comando (modifica estado)

```yaml
useCases:

  - id: UC-PRD-004
    name: ActivateProduct
    type: command
    actor: operator
    trigger:
      kind: http
      operationId: activateProduct   # coincide con el operationId del OpenAPI
    aggregate: Product
    method: activate(): void
    repositoryMethod: save(product)
    rules: [PRD-RULE-001]
    emits: ProductActivated
    implementation: full
```

### Use case de query (solo lectura)

```yaml
  - id: UC-PRD-001
    name: ListProducts
    type: query
    actor: operator
    trigger:
      kind: http
      operationId: listProducts
    aggregate: Product
    repositoryMethod: list(filters, page)
    rules: []
    emits: null
    implementation: full
```

### Use case disparado por evento (reacción a mensaje)

```yaml
  - id: UC-CAT-010
    name: HandleStockUpdated
    type: command
    actor: system
    trigger:
      kind: event
      event: StockUpdated
      channel: inventory.stock.updated   # canal AsyncAPI donde llega el evento
    aggregate: CatalogProductSnapshot    # readModel que se actualiza
    method: updateAvailability(productId, available): void
    repositoryMethod: save(snapshot)
    rules: []
    emits: null
    implementation: full
```

**Campos de un use case:**

| Campo | Descripción |
|---|---|
| `id` | `UC-{ABREV}-{NNN}`. La abreviatura es del BC (ej: `PRD`, `ORD`, `CAT`). |
| `name` | PascalCase. Nombre descriptivo de la operación. |
| `type` | `command` (modifica estado) \| `query` (solo lectura). |
| `actor` | `customer` \| `operator` \| `driver` \| `system`. |
| `trigger.kind` | `http` (llamada API) \| `event` (mensaje del broker). |
| `trigger.operationId` | Si `kind: http`, el `operationId` exacto del OpenAPI. |
| `trigger.event` | Si `kind: event`, nombre del evento consumido. |
| `trigger.channel` | Si `kind: event`, canal AsyncAPI del evento. |
| `aggregate` | Agregado sobre el que actúa el use case. |
| `method` | Firma del método de dominio en el agregado (para commands). |
| `repositoryMethod` | Método del repositorio llamado al final. |
| `rules` | Lista de RULE-IDs evaluados dentro del use case. |
| `emits` | Evento emitido al completar (`null` si ninguno). |
| `notFoundError` | ERROR_CODE lanzado si `findById` no retorna resultado. |
| `fkValidations` | Lista de validaciones de FK recibidas en el request. |
| `implementation` | `full` = generación completa. `scaffold` = esqueleto con TODOs. |

---

## `repositories` — Contratos de acceso a datos

Declara los métodos que el dominio necesita para leer y escribir sus agregados. Son
interfaces del dominio — el generador produce la implementación concreta.

Cada entrada tiene dos campos raíz:

| Campo | Descripción |
|---|---|
| `aggregate` | PascalCase. Nombre del agregado al que pertenece este repositorio. Un repositorio por agregado. |
| `methods` | Lista de métodos del repositorio. |

### Campos de un método

| Campo | Descripción |
|---|---|
| `name` | camelCase. Nombre del método. Ver convenciones de naming más abajo. |
| `params` | Lista de parámetros de entrada. Cada uno con `name`, `type`, y opcionalmente `required: false` si es un filtro opcional. |
| `returns` | Tipo de retorno. Ver tabla de tipos de retorno más abajo. |
| `derivedFrom` | Por qué existe este método. Ver valores válidos más abajo. |

### `derivedFrom` — origen del método

| Valor | Qué significa | Cuándo usarlo |
|---|---|---|
| `implicit` | Método estándar que el generador crea en todo repositorio, sin ninguna declaración explícita en el diseño. | `findById` y `save` siempre. |
| `RULE-ID` | El método existe porque una regla de dominio lo requiere. El ID apunta a la regla en `domainRules`. | Reglas `uniqueness` → `findBy{Campo}`; reglas `deleteGuard` → `delete`; reglas `crossAggregateConstraint` → `countBy{Campo}`. |
| `openapi:{operationId}` | El método existe porque un endpoint del OpenAPI necesita ese acceso a datos. El `operationId` referenciado debe existir en el OpenAPI del BC. | Queries con filtros (`list`, `listBy{Param}`). |

### Tipos de retorno

| Tipo de retorno | Cuándo usarlo |
|---|---|
| `Product?` | Nullable — el método puede no encontrar el registro. Siempre para `findById` y `findBy{Campo}`. |
| `Page[Product]` | Lista paginada con metadatos. Para métodos `list` con `PageRequest` como parámetro. |
| `List[Product]` | Lista sin paginación. Solo cuando el volumen está acotado (ej: entidades de un agregado). |
| `Int` | Conteo. Para métodos `countBy…` derivados de reglas `crossAggregateConstraint`. Siempre mayúscula. |
| `void` | Sin retorno. Solo para `delete`. |

### Convenciones de naming

| Método | Cuándo usarlo |
|---|---|
| `findById` | Siempre. Busca por la PK del agregado. |
| `findBy{Campo}` | Campo con `unique: true` en el agregado o regla `uniqueness`. Retorna `{Aggregate}?`. |
| `list` | Query con filtros opcionales. Acepta `PageRequest`. |
| `listBy{Param}` | Query filtrada por un único parámetro **obligatorio** (ej: `listByCategory`). |
| `countBy{Campo}` | Cuenta instancias que referencian otro agregado. Para reglas `crossAggregateConstraint`. |
| `save` | Siempre. INSERT o UPDATE del agregado. |
| `delete` | Solo si hay regla `deleteGuard`. Eliminación física. |

### Ejemplo completo

```yaml
repositories:

  - aggregate: Product
    methods:

      - name: findById              # implícito — siempre presente
        params:
          - name: id
            type: Uuid
        returns: "Product?"
        derivedFrom: implicit

      - name: findBySku             # derivado de PRD-RULE-002 (uniqueness en sku)
        params:
          - name: sku
            type: String(100)
        returns: "Product?"
        derivedFrom: PRD-RULE-002

      - name: list                  # derivado del endpoint GET /products del OpenAPI
        params:
          - name: status            # filtro opcional — el cliente puede omitirlo
            type: ProductStatus
            required: false
          - name: page              # siempre requerido en métodos list
            type: PageRequest
            required: true
        returns: "Page[Product]"
        derivedFrom: openapi:listProducts

      - name: countByCategoryId     # derivado de PRD-RULE-005 (crossAggregateConstraint)
        params:                     # verifica que la categoría no tenga productos antes
          - name: categoryId        # de permitir su eliminación
            type: Uuid
        returns: Int
        derivedFrom: PRD-RULE-005

      - name: save                  # implícito — siempre presente
        params:
          - name: entity
            type: Product
        returns: void
        derivedFrom: implicit

      - name: delete                # derivado de PRD-RULE-003 (deleteGuard)
        params:
          - name: id
            type: Uuid
        returns: void
        derivedFrom: PRD-RULE-003
```

---

## `errors` — Catálogo de errores del dominio

Un error por cada violación posible. El generador produce clases de excepción tipadas.

```yaml
errors:

  - code: PRODUCT_NOT_FOUND
    httpStatus: 404
    errorType: ProductNotFoundError

  - code: PRODUCT_NOT_ACTIVATABLE
    httpStatus: 422
    errorType: ProductNotActivatableError

  - code: PRODUCT_SKU_ALREADY_EXISTS
    httpStatus: 409
    errorType: ProductSkuAlreadyExistsError

  - code: PRODUCT_CANNOT_BE_DELETED
    httpStatus: 422
    errorType: ProductCannotBeDeletedError
```

| Campo | Descripción |
|---|---|
| `code` | SCREAMING_SNAKE_CASE. Referenciado en `domainRules[].errorCode` y `useCases[].notFoundError`. |
| `httpStatus` | Código HTTP que el adaptador REST devuelve al cliente. |
| `errorType` | PascalCase con sufijo `Error`. Nombre de la clase de excepción generada. |

**Guía de `httpStatus`:**

| Código | Cuándo usarlo |
|---|---|
| `400` | Request malformado o con datos inválidos. |
| `404` | Entidad no encontrada por ID. |
| `409` | Conflicto (violación de unicidad, estado ya en el valor pedido). |
| `422` | La entidad existe pero la operación no puede ejecutarse (precondición de negocio no cumplida). |

---

## `integrations` — Dependencias del BC

Declara de qué depende este BC (`outbound`) y quién depende de él (`inbound`). Complementa
el `system.yaml` con detalle operacional — los nombres de operaciones aquí deben coincidir
exactamente con los `contracts` declarados en las integraciones de `system.yaml`.

La sección tiene dos subsecciones fijas:

| Subsección | Qué declara |
|---|---|
| `outbound` | BCs o sistemas externos a los que este BC llama. Uno por dependencia. |
| `inbound` | BCs que llaman a este BC para consumir sus endpoints. Uno por consumidor. |

---

### `outbound` — dependencias que este BC consume

Campos de cada entrada `outbound`:

| Campo | Descripción |
|---|---|
| `name` | kebab-case. Nombre del BC o sistema externo al que se llama. Debe existir en `system.yaml` como `boundedContext` o `externalSystem`. |
| `type` | `internalBc` si es un BC del mismo sistema; `externalSystem` si es un servicio de terceros. |
| `pattern` | Relación de integración: `customerSupplier` (el proveedor dicta el contrato) \| `acl` (este BC traduce el modelo externo — obligatorio para `externalSystem`) \| `conformist` (este BC adopta el modelo del proveedor tal cual). |
| `protocol` | Mecanismo de transporte: `http` \| `grpc` \| `message-broker`. |
| `description` | Por qué este BC necesita llamar al otro y qué obtiene de él. |
| `operations` | Lista de operaciones que se invocan en el BC/sistema externo. |

Campos de cada `operation` en `outbound`:

| Campo | Descripción |
|---|---|
| `name` | camelCase. Debe coincidir exactamente con el string declarado en `contracts` de `system.yaml` para esta integración. |
| `description` | Qué retorna o qué efecto produce esta operación. |
| `triggersOn` | UC-ID del use case de este BC que dispara la llamada (ej: `UC-PRD-001`). |
| `responseEvents` | Opcional. Eventos emitidos por este BC como consecuencia de la respuesta recibida. |

```yaml
integrations:

  outbound:

    # Dependencia sincrónica hacia otro BC interno
    - name: inventory
      type: internalBc
      pattern: customerSupplier   # inventory dicta el contrato
      protocol: http
      description: >
        catalog calls inventory to read current stock status and expose
        isAvailable on product GET responses.
      operations:
        - name: getStockItem             # coincide con contracts en system.yaml
          description: Returns current stock status (available: boolean) for a product.
          triggersOn: UC-PRD-001         # el use case ListProducts dispara esta llamada

    # Dependencia hacia un sistema externo (siempre ACL)
    - name: payment-gateway
      type: externalSystem
      pattern: acl                # ACL traduce el modelo externo — obligatorio para externos
      protocol: http
      description: >
        catalog uses payment-gateway to validate card tokens before activating
        premium products. ACL prevents gateway DTOs from leaking into the domain.
      operations:
        - name: validateCardToken
          description: Validates that a card token is still active and chargeable.
          triggersOn: UC-PRD-004
```

---

### `inbound` — consumidores que llaman a este BC

Campos de cada entrada `inbound`:

| Campo | Descripción |
|---|---|
| `name` | kebab-case. Nombre del BC que consume los endpoints de este BC. |
| `type` | Siempre `internalBc` — los sistemas externos no declaran `inbound` (ellos llaman a nuestro BC, no al revés). |
| `pattern` | Generalmente `customerSupplier` — este BC es el supplier. |
| `protocol` | Mecanismo de transporte. Casi siempre `http`. |
| `description` | Qué consume el BC llamante y para qué lo usa. |
| `operations` | Lista de endpoints de **este BC** que el consumidor invoca. |

Campos de cada `operation` en `inbound`:

| Campo | Descripción |
|---|---|
| `name` | camelCase. Nombre del endpoint. Coincide con el `operationId` en el OpenAPI de este BC y con el `contract` en `system.yaml`. |
| `definedIn` | Archivo OpenAPI o AsyncAPI donde está definido el endpoint (ej: `catalog-open-api.yaml`). |
| `endpoint` | Método HTTP y ruta del endpoint (ej: `POST /api/catalog/v1/products/validate`). |

```yaml
  inbound:

    - name: orders
      type: internalBc
      pattern: customerSupplier   # este BC (catalog) es el supplier
      protocol: http
      description: >
        orders calls catalog to validate product existence and snapshot
        current prices before confirming a new order.
      operations:
        - name: validateProductsAndPrices   # operationId en catalog-open-api.yaml
          definedIn: catalog-open-api.yaml
          endpoint: POST /api/catalog/v1/products/validate

        - name: getProductById
          definedIn: catalog-open-api.yaml
          endpoint: GET /api/catalog/v1/products/{id}
```

> **Relación con `system.yaml`:** cada `operation.name` en `outbound` e `inbound` debe
> aparecer como string en `contracts` de la integración correspondiente en `system.yaml`.
> Si hay discrepancia, el Paso 2 es incoherente con el Paso 1.

---

## `domainEvents` — Eventos publicados y consumidos

Declara los mensajes de dominio que este BC envía al broker (`published`) y los que
recibe y procesa (`consumed`). Son la fuente de verdad para el `{bc-name}-async-api.yaml`
que se genera en el Paso 2.

La sección tiene dos subsecciones fijas:

| Subsección | Qué declara |
|---|---|
| `published` | Eventos que este BC emite cuando ocurre algo significativo en el dominio. |
| `consumed` | Eventos emitidos por otros BCs que este BC escucha y procesa. |

---

### `published` — eventos que este BC emite

Campos de cada evento publicado:

| Campo | Descripción |
|---|---|
| `name` | PascalCase en tiempo pasado. Describe qué ocurrió (ej: `ProductActivated`, `OrderConfirmed`). Debe coincidir con el `name` en `contracts` de `system.yaml` para las integraciones `channel: message-broker` donde este BC es el `from`. |
| `description` | Cuándo se emite, qué transición o acción lo dispara, y qué efecto produce en los BCs consumidores. |
| `payload` | Lista de campos que viajan con el evento. Ver reglas del payload más abajo. |

Campos de cada campo del `payload`:

| Campo | Descripción |
|---|---|
| `name` | camelCase. Nombre del campo. |
| `type` | Tipo canónico (`Uuid`, `String`, `DateTime`, `Money`, etc.). |
| `required` | `true` \| `false`. Omitir si siempre es requerido (se asume `true`). |

```yaml
domainEvents:

  published:

    - name: ProductActivated
      description: >
        Emitted when a product transitions from DRAFT to ACTIVE status via
        UC-PRD-004. Triggers StockItem creation in inventory BC.
      payload:
        - name: productId       # siempre incluir el ID del agregado
          type: Uuid
          required: true
        - name: name
          type: String(200)
          required: true
        - name: categoryId      # FK que el consumidor puede necesitar sin hacer lookup
          type: Uuid
          required: true
        - name: price           # snapshot del precio en el momento del evento
          type: Money
          required: true
        - name: occurredAt      # siempre incluir timestamp UTC del evento
          type: DateTime
          required: true

    - name: ProductDiscontinued
      description: >
        Emitted when a product reaches DISCONTINUED status. Triggers StockItem
        closure in inventory BC.
      payload:
        - name: productId
          type: Uuid
          required: true
        - name: occurredAt
          type: DateTime
          required: true
```

---

### `consumed` — eventos de otros BCs que este BC procesa

Campos de cada evento consumido:

| Campo | Descripción |
|---|---|
| `name` | PascalCase en tiempo pasado. Nombre del evento tal como lo publica el BC emisor. Debe coincidir con el `name` en `contracts` de `system.yaml` para las integraciones `channel: message-broker` donde este BC es el `to`. |
| `sourceBc` | kebab-case. BC que publica este evento. Debe existir en `system.yaml`. |
| `description` | Qué efecto produce este evento en este BC — qué agregado se actualiza o qué use case se dispara. |
| `payload` | Campos que llegan con el evento. Deben reflejar exactamente el payload del evento en el BC emisor. |

```yaml
  consumed:

    - name: StockUpdated
      sourceBc: inventory       # inventory es quien publica este evento
      description: >
        Updates the isAvailable flag on the CatalogProductSnapshot local read
        model when inventory reports a stock status change. Triggers UC-CAT-010.
      payload:
        - name: productId
          type: Uuid
          required: true
        - name: available
          type: Boolean
          required: true
        - name: occurredAt
          type: DateTime
          required: true
```

---

### Reglas del payload

1. **Siempre incluir `productId` (o el ID del agregado)** — el consumidor necesita saber de qué entidad habla el evento.
2. **Siempre incluir `occurredAt: DateTime`** — permite ordenar eventos y detectar mensajes llegados fuera de orden.
3. **Incluir todos los datos que el consumidor necesita sin hacer lookups posteriores** — si el consumidor necesita consultar el BC publicador para completar el procesamiento, falta información en el payload.
4. **No incluir datos internos** — el payload es un contrato público. No exponer campos `internal: true` ni datos que no tengan sentido fuera del BC.
5. **Usar snapshots para valores que cambian** — si el precio de un producto puede cambiar, el evento `OrderPlaced` debe incluir `unitPrice` como snapshot, no solo `productId`.

---

## Convenciones de nombres

| Elemento | Convención | Ejemplo |
|---|---|---|
| `bc` (valor) | kebab-case | `catalog`, `orders`, `payments` |
| Enum name | PascalCase + rol | `ProductStatus`, `OrderStatus` |
| Enum values | SCREAMING_SNAKE | `DRAFT`, `ACTIVE`, `PENDING_PAYMENT` |
| VO name | PascalCase + sustantivo | `Money`, `Slug`, `ShippingAddress` |
| Aggregate / Entity name | PascalCase + sustantivo | `Product`, `OrderLine` |
| Property name | camelCase | `categoryId`, `unitPrice` |
| Domain rule ID | `{ABREV}-RULE-{NNN}` | `PRD-RULE-001`, `ORD-RULE-003` |
| UC ID | `UC-{ABREV}-{NNN}` | `UC-PRD-004`, `UC-CAT-001` |
| Event name | PascalCase + pasado | `ProductActivated`, `OrderConfirmed` |
| Error code | SCREAMING_SNAKE | `PRODUCT_NOT_FOUND`, `ORDER_ALREADY_CONFIRMED` |

**Abreviaturas estándar:**

| BC | Abreviatura |
|---|---|
| `catalog` | `CAT` / `PRD` |
| `orders` | `ORD` |
| `inventory` | `INV` |
| `payments` | `PAY` |
| `customers` | `CUS` |
| `notifications` | `NOT` |
| `dispatch` | `DSP` |

---

## Relación con otros artefactos del Paso 2

| Artefacto | Relación con `{bc-name}.yaml` |
|---|---|
| `{bc-name}-open-api.yaml` | Los `useCases[trigger.operationId]` deben coincidir con los `operationId` del OpenAPI. |
| `{bc-name}-async-api.yaml` | Los eventos en `domainEvents.published` y `domainEvents.consumed` deben tener su canal en el AsyncAPI. |
| `{bc-name}-spec.md` | Narrativa de los mismos use cases, en prosa. |
| `{bc-name}-flows.md` | Los flujos Given/When/Then derivan de los `domainRules` y `useCases`. |
| `system.yaml` | `bc`, `type` y los eventos en `domainEvents` deben ser consistentes con `boundedContexts` e `integrations`. |
