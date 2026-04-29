# Nuevas características soportadas en archivos de diseño — Aggregates

Este documento describe las extensiones del schema YAML de Bounded Context introducidas por los cambios Tier 1, Tier 2 y Tier 3 del análisis de robustez del generador sobre `aggregates`. Todas las extensiones son **opcionales** y **retrocompatibles**: catálogos existentes siguen funcionando sin modificaciones.

> Las reglas siguen siendo declarativas y deterministas: si el YAML no provee los _hints_ necesarios el generador NO infiere — emite un `// TODO domainRule(...)` para que el humano complete el diseño (ver AGENTS.md).

---

## Índice

1. [`concurrencyControl: optimistic` — bloqueo optimista (S2)](#1-concurrencycontrol-optimistic--bloqueo-optimista-s2)
2. [`hidden: true` en propiedades (S5)](#2-hidden-true-en-propiedades-s5)
3. [`emits` como lista de eventos (S22)](#3-emits-como-lista-de-eventos-s22)
4. [`domainRules[]` con whitelist estricta (Tier 2)](#4-domainrules-con-whitelist-estricta-tier-2)
   - 4.1 `uniqueness`
   - 4.2 `statePrecondition`
   - 4.3 `terminalState`
   - 4.4 `sideEffect`
   - 4.5 `deleteGuard`
   - 4.6 `crossAggregateConstraint`
5. [Validaciones declarativas en propiedades (Tier 1)](#5-validaciones-declarativas-en-propiedades-tier-1)
6. [`equals` / `hashCode` / `toString` por id (S20)](#6-equals--hashcode--tostring-por-id-s20)
7. [Child entities `immutable: true` con constructor de creación (G4)](#7-child-entities-immutable-true-con-constructor-de-creación-g4)
8. [`softDelete` y cualificadores en repos (Tier 1)](#8-softdelete-y-cualificadores-en-repos-tier-1)
9. [Child entities — `relationship` y `cardinality` (S6)](#9-child-entities--relationship-y-cardinality-s6)
10. [Limitaciones (lo que sigue NO soportado)](#10-limitaciones-lo-que-sigue-no-soportado)

---

## 1. `concurrencyControl: optimistic` — bloqueo optimista (S2)

A nivel de aggregate. Cuando se declara, el generador inyecta `@Version Long version` en la entidad JPA correspondiente. No afecta al dominio puro (la versión es estrictamente un detalle de persistencia).

### YAML

```yaml
aggregates:
  - name: Category
    root: Category
    auditable: true
    softDelete: true
    concurrencyControl: optimistic   # ← opt-in
    properties:
      - name: name
        type: String
```

### Código generado (CategoryJpa.java)

```java
@Id
@Column(name = "id", nullable = false, updatable = false)
private UUID id;

@Version
@Column(name = "version", nullable = false)
private Long version;
```

### Cuándo usarlo

- Aggregates con concurrencia real entre comandos (alta competencia por la misma instancia).
- Aggregates que participan en sagas o procesos largos donde una lectura previa puede quedar obsoleta.

---

## 2. `hidden: true` en propiedades (S5)

A nivel de propiedad. Marca un campo como **interno** del dominio: existe en la entidad JPA y en el aggregate, pero NO se expone hacia afuera.

Efectos:

| Capa | Efecto |
|---|---|
| Domain entity | sin getter público |
| JPA entity | columna persistida + `@JsonIgnore` en el campo |
| ResponseDto | excluido |
| ApplicationMapper | excluido |

### YAML

```yaml
aggregates:
  - name: Order
    properties:
      - name: total
        type: BigDecimal
      - name: internalScore
        type: BigDecimal
        hidden: true                  # ← opt-in
```

### Código generado

`Order.java` (dominio): el campo existe y se asigna en el constructor, pero NO se genera `getInternalScore()`.

`OrderJpa.java` (infraestructura):

```java
@com.fasterxml.jackson.annotation.JsonIgnore
@Column(name = "internal_score")
private BigDecimal internalScore;
```

`OrderResponse.java` (DTO de salida): el campo NO aparece.

### Cuándo usarlo

- Métricas internas, scores anti-fraude, contadores técnicos.
- Cualquier dato persistido que no debe formar parte del contrato público (REST/eventos).

---

## 3. `emits` como lista de eventos (S22)

`emits` ahora acepta string (compatibilidad) **o** lista de strings. Cada entrada debe referenciar un evento declarado en `domainEvents.published`. Se valida unicidad dentro de la lista.

### YAML — string (compatibilidad)

```yaml
domainMethods:
  - name: discontinue
    emits: ProductDiscontinued
```

### YAML — lista (nuevo)

```yaml
domainMethods:
  - name: complete
    emits:
      - OrderCompleted
      - PaymentSettled
      - InventoryReserved
```

### Código generado

```java
public void complete() {
    // ... lógica de transición ...
    raise(new OrderCompletedEvent(this.getId(), Instant.now()));
    raise(new PaymentSettledEvent(this.getId(), this.getTotal(), Instant.now()));
    raise(new InventoryReservedEvent(this.getId(), Instant.now()));
}
```

### Cuándo usarlo

- Operaciones que coordinan más de un cambio de estado observable (transiciones complejas).
- Mantener un único `domainMethod` cohesionado en lugar de partirlo artificialmente para emitir múltiples eventos.

---

## 4. `domainRules[]` con whitelist estricta (Tier 2)

`domainRules[].type` ahora está restringido a una **lista blanca**. Cualquier valor fuera de ella es rechazado por el reader. Cualquier clave fuera de las permitidas (`id`, `type`, `errorCode`, `description`, `appliesTo`, `targetAggregate`, `targetRepositoryMethod`, `field`, `expectedStatus`) también es rechazada.

Todos los tipos exigen `errorCode` declarado en `errors[]`.

| `type` | Hints requeridos | Emisión |
|---|---|---|
| `uniqueness` | `field` | `@Column(unique = true)` + `findBy{Field}` en repo |
| `statePrecondition` | — | guard documental en domain method |
| `terminalState` | — | guard en `Enum.transitionTo()` |
| `sideEffect` | — | invocación dentro del domain method (split S13) |
| `deleteGuard` | `targetAggregate`, `targetRepositoryMethod` | inyección de repo + check de existencia en handler |
| `crossAggregateConstraint` | `targetAggregate`, `field`, `expectedStatus` | `findById(...).orElseThrow(...)` + guard de status en handler |

> Si los hints están **incompletos**, el generador emite `// TODO domainRule(<id>, <type>): <description>` en lugar de fallar; nunca infiere.

### 4.1 `uniqueness`

```yaml
errors:
  - name: SkuAlreadyExists
    code: SKU_ALREADY_EXISTS

aggregates:
  - name: Product
    properties:
      - name: sku
        type: String
    domainRules:
      - id: PROD-001
        type: uniqueness
        field: sku
        errorCode: SkuAlreadyExists
        description: SKU must be unique across the catalog.
```

Genera:

- En `ProductJpa`: `@Column(name = "sku", unique = true)`
- En `ProductRepository`: `Optional<Product> findBySku(String sku)`

### 4.2 `statePrecondition`

```yaml
domainRules:
  - id: ORD-010
    type: statePrecondition
    errorCode: OrderNotPending
    description: An order can only be paid when in PENDING status.
```

Documental: el guard real ocurre dentro del domain method (`if (this.status != PENDING) throw ...`) que el agente humano completa siguiendo el flow.

### 4.3 `terminalState`

```yaml
domainRules:
  - id: ORD-099
    type: terminalState
    errorCode: OrderAlreadyClosed
    description: A CANCELLED or DELIVERED order cannot transition again.
```

El generador emite el guard en `OrderStatus.transitionTo()` automáticamente, con base en las transiciones declaradas en el enum.

### 4.4 `sideEffect`

```yaml
domainRules:
  - id: PROD-050
    type: sideEffect
    errorCode: PriceHistoryAppendFailed
    description: When the price changes, append a new PriceHistory entry.
```

El split S13 separa `validateRules` de `sideEffectRules` en `computeMethodBody`, asegurando que las validaciones se ejecuten **antes** de los side-effects.

### 4.5 `deleteGuard`

Bloquea el delete de un aggregate cuando existen dependientes vivos en otro aggregate.

```yaml
errors:
  - name: CategoryHasActiveProducts
    code: CATEGORY_HAS_ACTIVE_PRODUCTS

aggregates:
  - name: Category
    useCases:
      - name: deleteCategory
        type: command
        implementation: scaffold
        rules: [CAT-DEL-001]
    domainRules:
      - id: CAT-DEL-001
        type: deleteGuard
        targetAggregate: Product               # ← otro aggregate del mismo BC
        targetRepositoryMethod: countActiveByCategoryId
        errorCode: CategoryHasActiveProducts
        description: A category cannot be deleted while it has active products.
```

Genera (en `DeleteCategoryCommandHandler.java`):

```java
private final ProductRepository productRepository;   // ← inyectado automáticamente

public CategoryResponse handle(DeleteCategoryCommand command) {
    Category category = categoryRepository
        .findById(UUID.fromString(command.id()))
        .orElseThrow(CategoryNotFoundError::new);

    // domainRule(CAT-DEL-001): CategoryHasActiveProducts
    if (productRepository.countActiveByCategoryId(category.getId()) > 0) {
        throw new CategoryHasActiveProductsError();
    }

    category.softDelete();
    categoryRepository.save(category);
    return mapper.toResponse(category);
}
```

> El método `countActiveByCategoryId` debe existir en `ProductRepository` (puede declararse vía un `repositoryQuery` o agregarse manualmente).

### 4.6 `crossAggregateConstraint`

Bloquea un comando cuando el aggregate referenciado no está en el estado esperado.

```yaml
errors:
  - name: ProductCategoryNotActive
    code: PRODUCT_CATEGORY_NOT_ACTIVE

aggregates:
  - name: Product
    useCases:
      - name: createProduct
        type: command
        implementation: scaffold
        input:
          - name: categoryId
            type: String
        rules: [PROD-CREATE-001]
    domainRules:
      - id: PROD-CREATE-001
        type: crossAggregateConstraint
        targetAggregate: Category
        field: categoryId                # ← input field del UC que carga el FK
        expectedStatus: ACTIVE           # ← literal del enum CategoryStatus
        errorCode: ProductCategoryNotActive
        description: A product can only be linked to an ACTIVE category.
```

Genera (en `CreateProductCommandHandler.java`):

```java
private final CategoryRepository categoryRepository;   // ← inyectado automáticamente

public ProductResponse handle(CreateProductCommand command) {
    // domainRule(PROD-CREATE-001): ProductCategoryNotActive
    Category category = categoryRepository
        .findById(UUID.fromString(command.categoryId()))
        .orElseThrow(ProductCategoryNotActiveError::new);
    if (category.getStatus() != CategoryStatus.ACTIVE) {
        throw new ProductCategoryNotActiveError();
    }

    Product product = Product.create(/* ... */);
    productRepository.save(product);
    return mapper.toResponse(product);
}
```

> Convención: el aggregate destino debe tener una propiedad cuyo `type` termine en `Status` (ej. `CategoryStatus`). Si no la encuentra, emite `// TODO`.

---

## 5. Validaciones declarativas en propiedades (Tier 1)

Las propiedades de aggregate root y child entities ahora pueden declarar validaciones que el generador convierte en _creation checks_ dentro del constructor de creación. Soporte BigDecimal-aware.

### Validaciones soportadas

| Validación | Tipos aplicables | Java emitido |
|---|---|---|
| `notEmpty: true` | String, List | `if (x == null \|\| x.isBlank()) throw ...` |
| `minLength: N` | String | `if (x.length() < N) throw ...` |
| `maxLength: N` | String | `if (x.length() > N) throw ...` |
| `pattern: "regex"` | String | `if (!x.matches("regex")) throw ...` |
| `min: N` | Integer, Long, BigDecimal | comparación numérica / `compareTo` |
| `max: N` | Integer, Long, BigDecimal | comparación numérica / `compareTo` |
| `positive: true` | Integer, Long, BigDecimal | `> 0` |
| `positiveOrZero: true` | Integer, Long, BigDecimal | `>= 0` |
| `minSize: N` | List | `if (x.size() < N) throw ...` |
| `maxSize: N` | List | `if (x.size() > N) throw ...` |

### YAML

```yaml
aggregates:
  - name: Product
    properties:
      - name: sku
        type: String
        notEmpty: true
        minLength: 3
        maxLength: 32
        pattern: "^[A-Z0-9-]+$"
      - name: price
        type: BigDecimal
        positive: true
      - name: tags
        type: List<String>
        maxSize: 10
```

### Código generado (Product.java)

```java
public static Product create(String sku, BigDecimal price, List<String> tags) {
    if (sku == null || sku.isBlank()) throw new IllegalArgumentException("sku must not be empty");
    if (sku.length() < 3) throw new IllegalArgumentException("sku must have at least 3 characters");
    if (sku.length() > 32) throw new IllegalArgumentException("sku must have at most 32 characters");
    if (!sku.matches("^[A-Z0-9-]+$")) throw new IllegalArgumentException("sku does not match required pattern");
    if (price == null || price.compareTo(BigDecimal.ZERO) <= 0) throw new IllegalArgumentException("price must be positive");
    if (tags != null && tags.size() > 10) throw new IllegalArgumentException("tags must have at most 10 items");
    // ... assignments ...
}
```

---

## 6. `equals` / `hashCode` / `toString` por id (S20)

Aggregate roots y child entities reciben automáticamente bloque `equals/hashCode/toString` basado en el `id`. No requiere YAML — siempre se emite. Documentado aquí porque es nuevo.

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Product other)) return false;
    return id != null && id.equals(other.id);
}

@Override
public int hashCode() {
    return id == null ? 0 : id.hashCode();
}

@Override
public String toString() {
    return "Product{id=" + id + "}";
}
```

---

## 7. Child entities `immutable: true` con constructor de creación (G4)

Antes: `immutable: true` impedía generar el constructor de creación. Ahora se genera correctamente con sus _creation checks_, tal como en aggregate roots.

```yaml
aggregates:
  - name: Product
    childEntities:
      - name: PriceHistory
        immutable: true
        properties:
          - name: amount
            type: BigDecimal
            positive: true
          - name: changedAt
            type: Instant
```

Genera `PriceHistory.create(BigDecimal amount, Instant changedAt)` con check `amount > 0`. Inmutabilidad se preserva: sin setters, sin métodos de negocio.

---

## 8. `softDelete` y cualificadores en repos (Tier 1)

### `softDelete: true` a nivel de aggregate

```yaml
aggregates:
  - name: Category
    softDelete: true
```

Efectos automáticos:

- Columna `deleted_at` (Instant) en `CategoryJpa`.
- Método `softDelete()` en el aggregate root.
- Repositorio: query `softDelete` con `@Modifying @Query("UPDATE ... SET deletedAt = :now WHERE id = :id")`.
- Las queries `delete*` declaradas en YAML se renombran automáticamente a `softDelete*` con la implementación canónica.

### Cualificadores en queries `count*`

El generador resuelve los cualificadores `NonDeleted` / `Deleted` automáticamente en aggregates con `softDelete: true`, y `{Literal}` / `Non{Literal}` para campos de status. Si no resuelve el cualificador, **falla explícitamente** (no inventa).

```yaml
repositoryQueries:
  - name: countActiveByCategoryId
    parameters:
      - name: categoryId
        type: UUID
    returns: long
```

Resuelve a:

```java
@Query("SELECT COUNT(p) FROM ProductJpa p WHERE p.categoryId = :categoryId AND p.status = 'ACTIVE' AND p.deletedAt IS NULL")
long countActiveByCategoryId(@Param("categoryId") UUID categoryId);
```

### Paginación NPE-safe

Si un UC pagina y `_page`/`_size` no se proveen, el generador emite defaults seguros:

```java
int page = command.page() != null ? command.page() : 0;
int size = command.size() != null ? command.size() : 20;
PageRequest.of(page, size);
```

---

## 9. Child entities — `relationship` y `cardinality` (S6)

Las entidades hijas dentro de un aggregate ahora aceptan dos campos opt-in que controlan **lifecycle** y **forma del campo**.

| Campo | Default | Valores permitidos | Significado |
|---|---|---|---|
| `relationship` | `composition` | `composition` \| `aggregation` | Lifecycle del hijo respecto al root |
| `cardinality` | `oneToMany` | `oneToMany` \| `oneToOne` | Forma del campo en el aggregate |

Cualquier otro valor es rechazado por el reader.

### 9.1 `relationship: composition` (default)

El hijo **pertenece** al root: nace y muere con él.

JPA: `@OneToMany(cascade = CascadeType.ALL, orphanRemoval = true)` (o `@OneToOne` si la cardinalidad lo es).

### 9.2 `relationship: aggregation`

El hijo tiene **lifecycle independiente** del root. El root lo referencia pero no lo destruye.

JPA: `cascade = { CascadeType.PERSIST, CascadeType.MERGE }, orphanRemoval = false`.

> Nota: `immutable: true` mantiene la cascada `{ CascadeType.PERSIST }` (más estricta) y siempre tiene precedencia sobre `relationship`.

### 9.3 `cardinality: oneToMany` (default)

Campo `private List<Child> children = new ArrayList<>();` con getter `unmodifiableList`. Métodos `addX(...)` y `removeX(id)` operan sobre la colección.

### 9.4 `cardinality: oneToOne`

Campo `private Child child;` (singular, sin init). El getter devuelve la entidad directamente. Los `domainMethods` `addX(...)` se generan como **asignación**:

```java
this.productImage = new ProductImage(url, altText, sortOrder);
```

Y `removeX(id)` se genera como _clear conditional_:

```java
if (this.productImage != null && this.productImage.getId().equals(imageId)) {
    this.productImage = null;
}
```

JPA emite `@OneToOne` con `nullable = true` en el `@JoinColumn`. El mapper `to{X}Domain` / `to{X}Jpa` se vuelve null-safe automáticamente.

### Matriz completa de cascade emitido en JPA

| `immutable` | `relationship` | `cardinality` | Annotation generada |
|---|---|---|---|
| `false` | `composition` | `oneToMany` | `@OneToMany(cascade = CascadeType.ALL, orphanRemoval = true)` |
| `false` | `composition` | `oneToOne` | `@OneToOne(cascade = CascadeType.ALL, orphanRemoval = true)` |
| `false` | `aggregation` | `oneToMany` | `@OneToMany(cascade = { PERSIST, MERGE }, orphanRemoval = false)` |
| `false` | `aggregation` | `oneToOne` | `@OneToOne(cascade = { PERSIST, MERGE }, orphanRemoval = false)` |
| `true` | (cualquiera) | `oneToMany` | `@OneToMany(cascade = { PERSIST }, orphanRemoval = false)` |
| `true` | (cualquiera) | `oneToOne` | `@OneToOne(cascade = { PERSIST }, orphanRemoval = false)` |

### YAML — ejemplo aggregation + oneToOne

```yaml
aggregates:
  - name: User
    properties:
      - name: email
        type: String
    entities:
      - name: UserPreferences
        relationship: aggregation       # ← lifecycle independiente
        cardinality: oneToOne           # ← un único hijo
        properties:
          - name: theme
            type: String
          - name: language
            type: String
```

### Código generado (User.java — extracto)

```java
private UserPreferences userPreferences;

// constructor
public User(UUID id, String email, UserPreferences userPreferences, ...) {
    this.id = id;
    this.email = email;
    this.userPreferences = userPreferences;   // sin defensive copy
    ...
}

public UserPreferences getUserPreferences() {
    return userPreferences;   // devuelto directamente
}
```

### Código generado (UserJpa.java — extracto)

```java
@OneToOne(cascade = { CascadeType.PERSIST, CascadeType.MERGE }, orphanRemoval = false, fetch = FetchType.LAZY)
@JoinColumn(name = "user_id", nullable = true)
private UserPreferencesJpa userPreferences;
```

### Cuándo usar cada combinación

| Caso | `relationship` | `cardinality` |
|---|---|---|
| Líneas de un pedido (`Order` → `OrderLine`) | `composition` | `oneToMany` |
| Imágenes que viven con el producto | `composition` | `oneToMany` |
| Preferencias UI de un usuario | `aggregation` o `composition` | `oneToOne` |
| Contrato vigente de un cliente (puede preexistir) | `aggregation` | `oneToOne` |
| Bitácora inmutable de cambios (`PriceHistory`) | `composition` + `immutable: true` | `oneToMany` |

---

## 10. Limitaciones (lo que sigue NO soportado)

El generador **detiene la build y notifica** si encuentra estos casos:

| Caso | Estado |
|---|---|
| `relationship: manyToMany` | ❌ Vetado por mala práctica DDD (no se implementará) |
| Ids no-UUID (Long, String, etc.) | ❌ No soportado |
| `applyTo` en eventos consumidos | ❌ No soportado |
| Índice único parcial (`where`) | ❌ No soportado |
| `unique` dentro de listas | ❌ No soportado |
| `domainRules[].type` fuera de la whitelist | ❌ Rechazado por el reader |
| Use case con lógica no trivial **sin** `implementation: scaffold` | ❌ Notificar al humano |

Si se necesita alguno de estos casos, debe abrirse una propuesta de extensión del schema siguiendo el criterio de AGENTS.md:

1. Identificar el campo o concepto faltante con precisión
2. Argumentar por qué es necesario (qué decisión ambigua resuelve)
3. Proponer la adición mínima al schema
4. Notificar al usuario **antes** de proceder

---

## Referencias cruzadas

- [`AGENTS.md`](../AGENTS.md) — reglas inviolables del generador
- [`docs/bc-yaml-guide.md`](bc-yaml-guide.md) — guía completa del schema BC
- [`docs/projections-new-features.md`](projections-new-features.md) — extensiones para projections
- [`src/utils/domain-rule-mapper.js`](../src/utils/domain-rule-mapper.js) — implementación del motor declarativo
- [`src/utils/validation-mapper.js`](../src/utils/validation-mapper.js) — implementación de creation checks
