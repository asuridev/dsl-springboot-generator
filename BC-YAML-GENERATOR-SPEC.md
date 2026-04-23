# BC-YAML-GENERATOR-SPEC.md
# Especificación de Interpretación del Archivo `{bc-name}.yaml`

> Este documento es la fuente de verdad para cualquier generador de código que procese
> los artefactos tácticos de Bounded Context producidos por el Paso 2 del framework DDD.
> Describe con precisión cómo traducir cada sección del archivo YAML a constructos de código.

---

## 1. Estructura del Archivo y Orden Canónico de Secciones

```
bc → type → description → enums → valueObjects → aggregates
  → useCases → repositories → errors → integrations → domainEvents
```

El generador debe procesar las secciones en este orden exacto para respetar
las dependencias entre constructos (los aggregates dependen de los enums y VOs,
los useCases dependen de los aggregates, etc.).

---

## 2. Cabecera del Archivo

```yaml
bc: catalog           # Identificador del BC en kebab-case. Debe coincidir con system.yaml.
type: core            # core | supporting | generic
description: >        # Propósito del BC. Se usa como Javadoc/TSDoc del módulo raíz.
```

**Reglas para el generador:**
- `bc` define el nombre del módulo/paquete raíz: `com.{system}.{bc}` en Java, `src/{bc}` en TS.
- `type` no produce código directamente; puede usarse como metadata en el manifiesto generado.
- `description` se inyecta como comentario de cabecera del módulo raíz.

---

## 3. Sección `enums`

```yaml
enums:
  - name: ProductStatus
    description: Lifecycle of a product in the catalog.
    values:
      - value: DRAFT
        description: Product is being configured; not visible to buyers.
        transitions:
          - to: ACTIVE
            triggeredBy: UC-CAT-003 ActivateProduct
            condition: CAT-RULE-001
            rules:
              - CAT-RULE-001
            emits: ProductActivated
      - value: ACTIVE
        transitions:
          - to: DISCONTINUED
            triggeredBy: UC-CAT-004 DiscontinueProduct
            condition: none
            emits: ProductDiscontinued
      - value: DISCONTINUED
        transitions: []
```

**Reglas para el generador:**

| Campo | Uso en generación |
|-------|------------------|
| `name` | Nombre del tipo enum. PascalCase. Genera `enum {Name}` en el dominio. |
| `values[].value` | Constante del enum. SCREAMING_SNAKE_CASE. |
| `values[].description` | Javadoc/TSDoc de la constante. |
| `transitions` | Metadata para el generador de máquina de estados. Deriva guards en métodos de dominio. |
| `transitions[].condition` | Si es un RULE-ID, el generador invoca la validación de esa regla antes de la transición. Si es `none`, transición libre. **Nunca texto libre.** |
| `transitions[].emits` | Si no es `null`, el generador emite ese evento de dominio al completar la transición. |
| `transitions[].rules` | Lista explícita de reglas evaluadas durante la transición. Puede solaparse con `condition`. |

**Tipos de enums:**
- **Enum con ciclo de vida** (`{Name}Status`): tiene `transitions`. Genera máquina de estados con guards.
- **Enum de clasificación** (sin `transitions`): genera enum simple sin lógica adicional.

**Regla:** un estado con `transitions: []` es un **estado terminal**. El generador debe impedir
cualquier llamada a métodos de transición sobre un agregado en ese estado (equivale a `CAT-RULE-002`).

---

## 4. Sección `valueObjects`

```yaml
valueObjects:
  - name: Money
    description: >
      Monetary amount with explicit currency.
    properties:
      - name: amount
        type: Decimal
        precision: 19
        scale: 4
        required: true
      - name: currency
        type: String(3)
        required: true
```

**Reglas para el generador:**

- Genera una clase/record inmutable (sin setters) en el paquete `domain.valueobject`.
- Los VOs no tienen `id` ni `@Entity` — son embeddables o serializados en columnas propias.
- `Decimal` con `precision`/`scale` mapea a `numeric(precision, scale)` en PostgreSQL y
  `BigDecimal` en Java / `string` (decimal format) en TypeScript + OpenAPI.
- En APIs REST y AsyncAPI, `amount` de tipo `Decimal` se serializa como **string**
  para evitar pérdida de precisión en sistemas intermedios (JSON float).
- Dos instancias de un VO son iguales si todos sus campos son iguales (igualdad estructural).

---

## 5. Sección `aggregates`

### 5.1 Cabecera del Agregado

```yaml
- name: Product
  root: Product
  auditable: true
  softDelete: true
  description: >
    A sellable item in the family basket catalog.
```

| Flag | Significado para el generador |
|------|------------------------------|
| `auditable: true` | Inyectar `createdAt: DateTime` y `updatedAt: DateTime` en la entidad de DB. **No declarar como propiedades en el YAML.** Exponerlos en responses de detalle (GET single). |
| `softDelete: true` | Inyectar `deletedAt: DateTime?` (nullable) en la entidad de DB. Todos los `findById`, `findAll`, `findBy*` filtran `WHERE deletedAt IS NULL` implícitamente. El endpoint `DELETE` mapea a `softDelete(id)` — pone `deletedAt = now()`. No generar endpoint de restore. |
| `readModel: true` | Agregado de proyección local (Local Read Model). Ver §5.5. |

### 5.2 Propiedades del Agregado

```yaml
properties:
  - name: id
    type: Uuid
    required: true
    readOnly: true
    defaultValue: generated

  - name: status
    type: ProductStatus
    required: true
    readOnly: true
    defaultValue: DRAFT
    indexed: true

  - name: sku
    type: String(100)
    required: true
    unique: true

  - name: categoryId
    type: Uuid
    required: true
    indexed: true
    references: Category
    relationship: association
    cardinality: manyToOne

  - name: password
    type: String(200)
    required: true
    hidden: true

  - name: attemptCount
    type: Integer
    required: true
    internal: true
```

**Flags de visibilidad (mutuamente excluyentes — omitir si ninguno aplica):**

| Flag | Incluido en request | Incluido en response | Persiste en DB | Uso típico |
|------|--------------------|--------------------|----------------|-----------|
| `readOnly: true` | NO | SÍ | SÍ | `id`, `slug`, `status`, `createdAt` |
| `hidden: true` | SÍ | NO | SÍ | `password`, `pin`, `secretToken` |
| `internal: true` | NO | NO | SÍ | `attemptCount`, `retryCount`, `lockReason` |
| _(ninguno)_ | SÍ | SÍ | SÍ | Campos mutables normales |

**`defaultValue` (solo válido con `readOnly: true`):**

| Valor | Significado |
|-------|------------|
| `generated` | UUID generado en el factory/constructor del agregado |
| `now()` | `DateTime.now(UTC)` resuelto en el application service al momento de la operación |
| `DRAFT`, `ACTIVE`, etc. | Literal del enum — estado inicial asignado en el constructor |
| `true` / `false` | Literal booleano |
| `source: authContext` | Valor inyectado desde el contexto de autenticación; no proviene del request |

**Campos de asociación:**

| Campo | Uso |
|-------|-----|
| `references` | Nombre del agregado al que apunta la FK |
| `relationship: association` | FK sin cascada — el objeto referenciado es independiente |
| `cardinality` | `manyToOne` → columna FK en esta tabla. `oneToOne` → columna FK en esta tabla con constraint UNIQUE. |
| `bc` | Presente solo si la FK referencia un agregado de **otro BC**. El generador no hace JOIN — valida existencia vía repository call del BC propietario. |

**Flags de índice:**

| Flag | Efecto en DB |
|------|-------------|
| `unique: true` | `UNIQUE INDEX` sobre esa columna |
| `indexed: true` | Índice no-único sobre esa columna |

### 5.3 Entidades del Agregado (`entities`)

```yaml
entities:
  - name: ProductImage
    relationship: composition
    cardinality: oneToMany
    description: Image associated with a product.
    properties:
      - name: id
        type: Uuid
        required: true
        readOnly: true
        defaultValue: generated
      - name: url
        type: Url
        required: true

  - name: PriceHistory
    relationship: composition
    cardinality: oneToMany
    immutable: true
    description: Immutable record of each price change.
    properties:
      ...
```

**Reglas para el generador:**

| Campo | Significado |
|-------|------------|
| `relationship: composition` | La entidad **no existe** fuera del agregado. No tiene repositorio propio. Se carga junto con la raíz. |
| `cardinality: oneToMany` | Colección en la raíz del agregado. Tabla separada con FK al agregado raíz. |
| `cardinality: oneToOne` | Objeto único. Puede ser tabla separada o columnas embeddidas según la complejidad. |
| `immutable: true` | Solo permite INSERT. Prohibir UPDATE y DELETE sobre registros individuales. El generador emite restricción en migración SQL (`NO UPDATE, NO DELETE`). Ejemplos: `PriceHistory`, `AuditLog`. |

### 5.4 Reglas de Dominio (`domainRules`)

```yaml
domainRules:
  - id: CAT-RULE-001
    type: statePrecondition
    errorCode: PRODUCT_CATEGORY_NOT_ACTIVE
    description: A product can only be activated if its category is in ACTIVE status.
```

**Tipos y lo que genera cada uno:**

| `type` | Genera | Dónde se evalúa |
|--------|--------|----------------|
| `statePrecondition` | Guard al inicio del método de dominio que verifica la condición antes de ejecutar la transición. Lanza `{errorType}` si falla. | Método del agregado |
| `uniqueness` | 1) Índice `UNIQUE` en DB. 2) Método `findBy{Campo}` en el repositorio. 3) Verificación en el application service antes de `save`. | Application service |
| `terminalState` | Guard que verifica que el estado actual no es terminal antes de cualquier mutación. Lanza `{errorType}`. | Método del agregado |
| `sideEffect` | Lógica adicional ejecutada **dentro** del método de dominio tras la acción principal (ej: crear entrada de historial, recalcular slug). | Método del agregado |
| `deleteGuard` | Guard en el use case de delete que verifica la condición antes de proceder. Lanza `{errorType}`. Requiere un método de conteo en el repositorio. | Application service (use case de delete) |
| `crossAggregateConstraint` | Método de query en el repositorio del agregado involucrado. Verificación en el application service. | Application service |

**`errorCode`** referencia exactamente una entrada del array `errors`. Omitir en `sideEffect` (no produce error).

### 5.5 Agregados `readModel` (Local Read Model)

```yaml
- name: CatalogSnapshot
  root: CatalogSnapshot
  readModel: true
  sourceBC: catalog
  sourceEvents:
    - ProductActivated
    - ProductPriceChanged
    - ProductDiscontinued
```

**Reglas para el generador:**
- **No generar** endpoints `POST`, `PATCH`, `DELETE` ni use cases de comando HTTP para este agregado.
- Solo generar use cases con `trigger.kind: event` (disparados por eventos del BC fuente).
- Las propiedades se determinan por los campos de los eventos consumidos.
- El repositorio solo expone métodos de lectura y `save` (usado por el event handler).

---

## 6. Sección `useCases`

### 6.1 Use Case de Comando (HTTP)

```yaml
- id: UC-CAT-006
  name: UpdateProductPrice
  type: command
  actor: operator
  trigger:
    kind: http
    operationId: updateProductPrice
  aggregate: Product
  method: updatePrice(newPrice): void
  repositoryMethod: save(Product)
  rules:
    - CAT-RULE-002
    - CAT-RULE-009
  emits: ProductPriceChanged
  notFoundError: PRODUCT_NOT_FOUND
  implementation: full
  fkValidations:
    - field: categoryId
      aggregate: Category
      notFoundError: CATEGORY_NOT_FOUND
      conditional: true
```

**Mapeo a código (Application Service):**

```
1. [Si notFoundError presente] → repo.findById(id) — lanzar {notFoundError} si null
2. [Para cada fkValidation] → {Aggregate}Repo.findById(field) — lanzar {notFoundError} si null
   - Si conditional: true → envolver en if (field != null)
3. [Para cada rule de tipo uniqueness] → repo.findBy{Campo}(valor) — lanzar {errorCode} si ya existe
4. [Para cada rule de tipo statePrecondition o terminalState] → se verifica DENTRO del método de dominio
5. aggregate.{method}(params) → ejecuta la lógica del dominio
6. repo.{repositoryMethod}(aggregate) → persiste el estado
7. [Si emits != null] → publicar evento {EventName} con el payload definido en domainEvents
```

**Campos del use case:**

| Campo | Significado |
|-------|------------|
| `id` | Identificador único del use case. Formato `UC-{ABREV}-{NNN}`. |
| `type: command` | Modifica estado. Genera método transaccional en el application service. |
| `type: query` | Solo lectura. Genera método no-transaccional (o transacción read-only). |
| `actor` | `customer`, `operator`, `driver`, `system`. Define el rol de seguridad requerido. |
| `trigger.kind: http` | Disparado por un endpoint REST. `operationId` referencia el OpenAPI. |
| `trigger.kind: event` | Disparado por un evento de dominio entrante. `event` y `channel` definen la suscripción AsyncAPI. |
| `aggregate` | Nombre del agregado raíz sobre el que opera el use case. |
| `method` | Firma del método del agregado invocado: `{methodName}({params}): {ReturnType}`. |
| `repositoryMethod` | Firma del método del repositorio usado para persistir o leer. |
| `rules` | Lista de RULE-IDs evaluados en este use case (para unicidad y guards externos al agregado). |
| `emits` | Evento de dominio publicado al completar con éxito. `null` si no emite. |
| `notFoundError` | Error lanzado si `findById` no retorna resultado. Puede ser lista si involucra entidades internas. |
| `fkValidations` | Validaciones de FK: verifica que los IDs referenciados existan antes de ejecutar. |
| `implementation` | `full` = lógica completa generada. `scaffold` = esqueleto con marcadores `// TODO: implement`. |

### 6.2 Use Case de Query (HTTP)

```yaml
- id: UC-CAT-017
  name: GetProductById
  type: query
  actor: operator
  trigger:
    kind: http
    operationId: getProductById
  aggregate: Product
  repositoryMethod: findById(Uuid)
  rules: []
  emits: null
  notFoundError: PRODUCT_NOT_FOUND
  implementation: full
```

**Diferencias respecto al comando:**
- No se invoca `method` sobre el agregado (no hay mutación).
- No se llama `save` — solo se llama el `repositoryMethod` de lectura.
- `notFoundError` aplica si `repositoryMethod` retorna `null`.
- El método del application service es `@Transactional(readOnly = true)` o equivalente.

### 6.3 Use Case Disparado por Evento

```yaml
- id: UC-ORD-010
  name: UpdateCatalogSnapshot
  type: command
  actor: system
  trigger:
    kind: event
    event: ProductPriceChanged
    channel: catalog.product.price-changed
  aggregate: CatalogSnapshot
  method: updatePrice(productId, newPrice): void
  repositoryMethod: save(CatalogSnapshot)
  rules: []
  emits: null
  implementation: full
```

**Mapeo a código:**
- Genera un **event handler/consumer** suscrito al canal AsyncAPI `channel`.
- El `actor: system` indica que no hay autenticación HTTP; el trigger es el evento entrante.
- El cuerpo sigue la misma secuencia que un comando HTTP (findById → method → save).

### 6.4 Validación de Entrada (HTTP Boundary)

El generador deriva las validaciones del request DTO directamente del YAML, de forma **framework-agnóstica**. Los templates del generador para cada lenguaje o framework target son los responsables de expresar estas constraints en el mecanismo propio (anotaciones, schemas de validación, middleware, pipes, etc.). El YAML no cambia entre targets.

**Modelo de capas de validación:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Capa 1 — HTTP Boundary (controller / handler / route)          │
│  Qué valida : forma y formato del request DTO                   │
│  Fuente YAML: type + required/opcional en la firma del method   │
│  Errores    : HTTP 400                                          │
├─────────────────────────────────────────────────────────────────┤
│  Capa 2 — Application Service                                   │
│  Qué valida : existencia de FKs y unicidad de campos            │
│  Fuente YAML: fkValidations + domainRules[type: uniqueness]     │
│  Errores    : HTTP 404, HTTP 409                                │
├─────────────────────────────────────────────────────────────────┤
│  Capa 3 — Aggregate method                                      │
│  Qué valida : invariantes de dominio y precondiciones de estado │
│  Fuente YAML: domainRules[statePrecondition, terminalState]     │
│  Errores    : HTTP 409, HTTP 422                                │
└─────────────────────────────────────────────────────────────────┘
```

**Derivación de campos del request DTO:**

Los campos del DTO se obtienen tomando los parámetros de la firma `method(params)` del use case y resolviendo cada uno contra las propiedades del agregado. Un campo **aparece en el request** si y solo si no tiene los flags `readOnly`, `internal`, ni `source: authContext`. Un parámetro marcado con `?` en la firma es opcional; los demás son requeridos.

**Tabla de constraints semánticas (framework-agnóstico):**

| Condición en el YAML | Constraint semántica |
|----------------------|---------------------|
| Parámetro en `method` sin `?` | Campo requerido — no puede ser nulo ni ausente |
| Parámetro en `method` con `?` | Campo opcional — puede ser nulo o ausente |
| `type: String(n)` | Longitud máxima = n caracteres |
| `type: Email` | Debe cumplir formato de dirección de correo electrónico válida |
| `type: Url` | Debe cumplir formato de URI absoluta válida |
| `type: Uuid` | Debe cumplir formato UUID (8-4-4-4-12 hexadecimal) |
| `type: Decimal` | Debe ser parseable como número decimal; se serializa como string en JSON |
| `type: Integer` / `Long` | Debe ser un entero sin parte decimal |
| `type: Date` | Debe cumplir formato ISO 8601 date (`YYYY-MM-DD`) |
| `type: DateTime` | Debe cumplir formato ISO 8601 date-time con timezone |
| `type: {EnumName}` | Debe ser uno de los valores declarados en `enums[name={EnumName}].values` |

**VOs como campos del request:**

Cuando un parámetro del `method` es de tipo VO (ej: `newPrice: Money`), el generador expande las propiedades del VO como campos anidados en el DTO y aplica las constraints de cada propiedad del VO de forma recursiva.

---

## 7. Sección `repositories`

```yaml
repositories:
  - aggregate: Product
    methods:
      - name: findById
        params:
          - name: id
            type: Uuid
        returns: "Product?"
        derivedFrom: implicit

      - name: findBySku
        params:
          - name: sku
            type: String(100)
        returns: "Product?"
        derivedFrom: CAT-RULE-003

      - name: list
        params:
          - name: categoryId
            type: Uuid
            required: false
          - name: status
            type: ProductStatus
            required: false
          - name: page
            type: PageRequest
            required: true
        returns: "Page[Product]"
        derivedFrom: openapi:listProducts

      - name: save
        params:
          - name: entity
            type: Product
        derivedFrom: implicit
```

**Reglas para el generador:**

| `derivedFrom` | Origen de la necesidad | Qué genera |
|---------------|----------------------|-----------|
| `implicit` | Siempre necesario (findById, save) | Métodos base de todo repositorio |
| `{RULE-ID}` | Una regla de dominio requiere esta query | Método de consulta derivado de la regla |
| `openapi:{operationId}` | Un endpoint de listado requiere filtros paginados | Método con parámetros opcionales + paginación |

**Tipos de retorno:**
- `{Aggregate}?` → retorna el agregado o `null`/`Optional.empty()`
- `Page[{Aggregate}]` → retorna página con contenido, número de página y total
- `Int` → contador (para guards de tipo `deleteGuard` o `crossAggregateConstraint`)
- `void` → implícito en `save` / `delete`

**Parámetros opcionales (`required: false`):**
- En `list`, los filtros opcionales generan `WHERE` condicionales (`AND field = :value IF value != null`).
- `PageRequest` es siempre `required: true`; contiene `page: Int` y `size: Int`.

**Generación de la interfaz:**
```
interface {Aggregate}Repository {
  findById(id: Uuid): {Aggregate}?
  findBy{Campo}({campo}: Type): {Aggregate}?
  list(filters..., page: PageRequest): Page[{Aggregate}]
  save(entity: {Aggregate}): void
}
```

**Generación de la implementación:**
- Para `unique` fields: la implementación ejecuta la query y el application service verifica el resultado.
- Para `softDelete: true`: todos los métodos `find*` y `list` añaden `WHERE deletedAt IS NULL`.

---

## 8. Sección `errors`

```yaml
errors:
  - code: PRODUCT_NOT_FOUND
    httpStatus: 404
    errorType: ProductNotFoundError

  - code: PRODUCT_ALREADY_DISCONTINUED
    httpStatus: 409
    errorType: ProductAlreadyDiscontinuedError

  - code: PRODUCT_CATEGORY_NOT_ACTIVE
    httpStatus: 422
    errorType: ProductCategoryNotActiveError
```

**Mapeo a código:**

| Campo | Uso |
|-------|-----|
| `code` | Constante SCREAMING_SNAKE_CASE usada en el dominio para identificar el error. También es el campo `code` en el cuerpo JSON del error de respuesta. |
| `httpStatus` | Código HTTP retornado por el exception handler global cuando este error es lanzado. |
| `errorType` | Nombre de la clase de excepción/error generada. PascalCase con sufijo `Error`. Extiende la clase base de error del BC o la clase base del sistema. |

**Guía de HTTP status:**
- `400` — solicitud malformada (validación de request)
- `404` — recurso no encontrado (`*NotFoundError`)
- `409` — conflicto de estado o unicidad (`*AlreadyExists`, `*AlreadyDiscontinued`)
- `422` — entidad no procesable — precondición de dominio no cumplida (`*NotActive`, `*Precondition`)

**Estructura del cuerpo de error generado (JSON):**
```json
{
  "code": "PRODUCT_NOT_FOUND",
  "message": "Product with id '{id}' was not found.",
  "timestamp": "2026-04-23T12:00:00Z"
}
```

---

## 9. Sección `integrations`

```yaml
integrations:
  outbound:
    - name: inventory
      type: internalBc
      pattern: customerSupplier
      protocol: amqp
      description: >
        Notifies inventory of product lifecycle changes.
      operations:
        - name: ProductActivated
          description: Signals that a new active product requires a StockItem.
          triggersOn: UC-CAT-003
        - name: ProductDiscontinued
          description: Signals product retirement.
          triggersOn: UC-CAT-004

  inbound:
    - name: orders
      type: internalBc
      pattern: customerSupplier
      protocol: http
      operations:
        - name: getProductPrice
          definedIn: catalog-open-api.yaml
          endpoint: GET /api/catalog/v1/products/{id}
```

**Reglas para el generador:**

**Outbound (publicación):**
- Cada operación en `outbound` corresponde a un evento de dominio publicado por el use case referenciado en `triggersOn`.
- El generador crea un `{EventName}Publisher` / `MessageProducer` que se inyecta en el application service del use case.
- `protocol: amqp` → genera producer de RabbitMQ (exchange + routing key derivados del nombre del evento).
- `protocol: http` → genera cliente HTTP (REST client / Feign) apuntando al BC destino.

**Inbound (consumo):**
- Operaciones en `inbound` documentan qué endpoints de **este BC** consumen otros BCs.
- No genera código adicional — el endpoint ya existe por los use cases de tipo `query`.
- Sirve como documentación de dependencias entrantes.

**Patrones de integración:**

| `pattern` | Significado |
|-----------|------------|
| `customerSupplier` | El BC fuente dicta el contrato; el BC consumidor se adapta. Evento/API definido por el supplier. |
| `acl` | Anti-Corruption Layer. El BC consumidor traduce activamente el modelo del supplier al suyo propio. Genera una capa de traducción. |
| `conformist` | El BC consumidor adopta el modelo del supplier sin traducción. |

---

## 10. Sección `domainEvents`

### 10.1 Eventos Publicados

```yaml
domainEvents:
  published:
    - name: ProductPriceChanged
      description: Emitted when a product's price is updated.
      payload:
        - name: productId
          type: Uuid
          required: true
        - name: previousPrice
          type: Money
          required: true
        - name: newPrice
          type: Money
          required: true
```

**Mapeo a código:**
- Genera una clase/record inmutable en el paquete `domain.event`: `{EventName}Event`.
- Campos obligatorios adicionales inyectados por el generador (no declarar en YAML):
  - `eventId: Uuid` — identificador único del evento (idempotencia)
  - `occurredAt: DateTime` — timestamp UTC de emisión
  - `bcSource: String` — nombre del BC emisor (valor fijo = `bc` del archivo)
- Los eventos son inmutables (solo constructor, sin setters).
- En `Money`, `amount` se serializa como string decimal en el payload de mensajería.

### 10.2 Eventos Consumidos

```yaml
  consumed:
    - name: ProductActivated
      sourceBc: catalog
      description: >
        When a product is activated in catalog, inventory creates a StockItem.
      payload:
        - name: productId
          type: Uuid
          required: true
        - name: sku
          type: String(100)
          required: true
```

**Mapeo a código:**
- Genera un `{EventName}ConsumerHandler` / `MessageListener` en el paquete `application.event`.
- El handler deserializa el payload y delega al application service del use case con `trigger.kind: event`.
- Se registra la suscripción al canal AsyncAPI correspondiente.
- El generador implementa idempotencia verificando `eventId` antes de procesar (tabla de eventos procesados o cache).

---

## 11. Sistema de Tipos Canónicos

Todos los `type` en el YAML usan el vocabulario canónico. El generador mapea así:

| Tipo canónico | Constraint semántica | Java | TypeScript | PostgreSQL | OpenAPI format |
|---------------|---------------------|----- |-----------|------------|---------------|
| `Uuid` | formato UUID | `UUID` | `string` | `uuid` | `string` (uuid) |
| `String` | — | `String` | `string` | `text` | `string` |
| `String(n)` | longitud máxima n | `String` | `string` | `varchar(n)` | `string` (maxLength: n) |
| `Text` | — | `String` | `string` | `text` | `string` |
| `Integer` | entero sin decimales | `Integer` | `number` | `integer` | `integer` |
| `Long` | entero 64 bits sin decimales | `Long` | `number` | `bigint` | `integer` (int64) |
| `Decimal` | parseable como decimal; string en JSON | `BigDecimal` | `string` | `numeric(p,s)` | `string` (decimal) |
| `Boolean` | `true` o `false` | `Boolean` | `boolean` | `boolean` | `boolean` |
| `Date` | ISO 8601 date `YYYY-MM-DD` | `LocalDate` | `string` | `date` | `string` (date) |
| `DateTime` | ISO 8601 date-time con timezone | `Instant` | `string` | `timestamptz` | `string` (date-time) |
| `Duration` | ISO 8601 duration | `Duration` | `string` | `interval` | `string` (duration) |
| `Email` | formato de correo electrónico válido | `String` | `string` | `varchar(254)` | `string` (email) |
| `Url` | URI absoluta válida | `URI` | `string` | `text` | `string` (uri) |
| `Money` | VO expandido (amount + currency) | VO class | VO interface | `numeric(19,4)` + `varchar(3)` | `object` (amount+currency) |
| `List[T]` | — | `List<T>` | `T[]` | tabla relacional | `array` |
| `PageRequest` | — | (framework type) | (framework type) | — | query params: page + size |

> La columna **Constraint semántica** es framework-agnóstica. Los templates del generador para cada target (Java, TypeScript, Python, etc.) son los responsables de expresar estas constraints en el mecanismo propio del framework (anotaciones, schemas Zod/Pydantic, middleware de validación, etc.).
> Las constraints de §6.4 y las de esta tabla son complementarias: §6.4 cubre requerido/opcional y derivación de campos del DTO; esta tabla cubre el formato/tipo de cada campo.

**Tipos prohibidos en el YAML** (el generador debe rechazarlos con error de validación):
`string`, `int`, `number`, `float`, `bool`, `date`, `timestamp`, `any`, `object`, `varchar(n)`, `bigint`

---

## 12. Niveles de Implementación (`implementation`)

| Valor | Descripción |
|-------|------------|
| `full` | El generador produce el código completo y funcional. No hay TODOs. |
| `scaffold` | El generador produce la estructura (clase, método, firma, inyecciones) con `// TODO: implement` en el cuerpo. El desarrollador completa la lógica. |

**Cuándo usar `scaffold`:**
- Lógica de negocio compleja que requiere decisiones del desarrollador.
- Reglas con condiciones que involucran múltiples agregados cruzados.
- Flujos de compensación o sagas que deben revisarse manualmente.

---

## 13. Convenciones de Nombres

| Elemento | Convención | Ejemplo |
|----------|-----------|---------|
| `bc` (valor) | kebab-case | `catalog`, `orders`, `payments` |
| Enum name | PascalCase + rol | `ProductStatus`, `CategoryStatus` |
| Enum value | SCREAMING_SNAKE_CASE | `DRAFT`, `ACTIVE`, `PENDING_PAYMENT` |
| VO name | PascalCase + sustantivo | `Money`, `Address`, `Slug` |
| Aggregate name | PascalCase + sustantivo | `Product`, `Order`, `Customer` |
| Entity name | PascalCase + sustantivo | `OrderLine`, `ProductImage`, `PriceHistory` |
| Property name | camelCase | `categoryId`, `unitPrice`, `createdAt` |
| Domain rule ID | `{ABREV}-RULE-{NNN}` | `CAT-RULE-001`, `ORD-RULE-003` |
| Use case ID | `UC-{ABREV}-{NNN}` | `UC-CAT-006`, `UC-ORD-014` |
| Event name | PascalCase + pasado | `ProductActivated`, `OrderConfirmed` |
| Error code | SCREAMING_SNAKE_CASE | `PRODUCT_NOT_FOUND`, `SKU_ALREADY_EXISTS` |
| Error type | PascalCase + `Error` | `ProductNotFoundError`, `SkuAlreadyExistsError` |
| Operation ID | camelCase | `createProduct`, `listCategories` |

**Abreviaturas estándar de BCs del sistema:**

| BC | Abreviatura en IDs |
|----|-------------------|
| catalog | CAT |
| orders | ORD |
| inventory | INV |
| payments | PAY |
| customers | CUS |
| delivery | DEL |
| notifications | NOT |

---

## 14. Estructura de Directorios Generados (Referencia)

Para un BC `catalog` con arquitectura hexagonal y modular monolith en Java/TypeScript:

```
src/
  catalog/
    domain/
      aggregate/
        Product.java (o .ts)
        Category.java
      entity/
        ProductImage.java
        PriceHistory.java
      valueobject/
        Money.java
      event/
        ProductActivatedEvent.java
        ProductPriceChangedEvent.java
        ProductDiscontinuedEvent.java
      enum/
        ProductStatus.java
        CategoryStatus.java
      rule/
        (guards y validadores de dominio)
      repository/
        ProductRepository.java        ← interfaz
        CategoryRepository.java       ← interfaz
      error/
        ProductNotFoundError.java
        SkuAlreadyExistsError.java
        ...
    application/
      usecase/
        UpdateProductPriceUseCase.java
        ActivateProductUseCase.java
        ...
      event/
        ProductActivatedConsumerHandler.java
    infrastructure/
      persistence/
        ProductJpaRepository.java     ← implementación
        CategoryJpaRepository.java
      messaging/
        ProductEventPublisher.java
      http/
        CatalogController.java        ← endpoints REST
```

---

## 15. Validaciones que el Generador Debe Ejecutar

Antes de generar código, el generador debe validar:

1. **Integridad de referencias:**
   - Cada `rules[].RULE-ID` debe existir en `domainRules` del mismo o de otro agregado del mismo BC.
   - Cada `notFoundError` y `errorCode` debe existir en `errors`.
   - Cada `emits` (distinto de `null`) debe existir en `domainEvents.published`.
   - Cada `operationId` debe existir en el archivo `{bc-name}-open-api.yaml`.

2. **Consistencia de tipos:**
   - Ningún `type` puede ser de los tipos prohibidos.
   - `Decimal` siempre debe tener `precision` y `scale`.
   - `readOnly: true` siempre debe tener `defaultValue` o `source: authContext`.

3. **Unicidad de IDs:**
   - No pueden existir dos use cases con el mismo `id`.
   - No pueden existir dos reglas con el mismo `id`.
   - No pueden existir dos errores con el mismo `code`.

4. **Agregados `readModel`:**
   - Deben tener `sourceBC` y `sourceEvents`.
   - Todos sus use cases deben tener `trigger.kind: event`.

5. **Estados terminales:**
   - Un estado con `transitions: []` implica automáticamente una regla de tipo `terminalState`.
   - El generador puede inferirla aunque no esté declarada explícitamente en `domainRules`.

---

## 16. Referencia Rápida — Flujo de Generación por Sección

```
1. Leer cabecera (bc, type, description)
2. Generar enums
3. Generar value objects
4. Para cada aggregate:
   a. Generar clase raíz con propiedades (aplicar flags de visibilidad)
   b. Generar entidades internas (aplicar immutable si aplica)
   c. Generar interfaz del repositorio a partir de repositories[]
   d. Generar métodos de dominio a partir de enums.transitions + domainRules
5. Para cada useCase con trigger.kind: http:
   a. Derivar campos del request DTO desde la firma method(params) + propiedades del agregado
   b. Generar constraints semánticas del DTO (Capa 1 — ver §6.4)
      → campos requeridos/opcionales, tipos, formatos
      → expandir VOs a campos anidados con sus propias constraints
   c. Generar método en el application service
   d. Aplicar secuencia: findById → fkValidations → rules → method → save → emits
6. Para cada useCase con trigger.kind: event → generar consumer handler
7. Generar clases de error
8. Generar event classes (published) y consumer handlers (consumed)
9. Generar publishers de outbound integrations
10. Generar migration SQL (tablas, índices UNIQUE/no-unique, columnas de auditoría)
```
