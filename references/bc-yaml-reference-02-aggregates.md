# Referencia de `{bc}.yaml` — Parte 2: Aggregates

Esta sección documenta la sección `aggregates` del YAML táctico. Es la más extensa
y la más importante: define el modelo de dominio que el generador convierte en
entidades Java, reglas de negocio, y lógica de persistencia JPA.

---

## Tabla de contenidos

1. [Estructura de un agregado](#1-estructura-de-un-agregado)
2. [Propiedades del agregado raíz](#2-propiedades-del-agregado-raíz)
3. [Propiedades individuales (`properties`)](#3-propiedades-individuales-properties)
4. [Entidades hijas (`entities`)](#4-entidades-hijas-entities)
5. [Métodos de dominio (`domainMethods`)](#5-métodos-de-dominio-domainmethods)
6. [Reglas de dominio (`domainRules`)](#6-reglas-de-dominio-domainrules)
7. [Flags de agregado: `auditable`, `softDelete`, `readOnly`](#7-flags-de-agregado)
8. [Agregados read model](#8-agregados-read-model)

---

## 1. Estructura de un agregado

```yaml
aggregates:

  - name: Product
    root: Product
    auditable: true
    softDelete: false
    properties:
      - name: id
        type: Uuid
        required: true
        readOnly: true
        defaultValue: generated
      - name: sku
        type: String(50)
        required: true
        indexed: true
      - name: name
        type: String(200)
        required: true
        validations:
          - minLength: 3
      - name: status
        type: ProductStatus
        required: true
      - name: price
        type: Money
        required: true
      - name: categoryId
        type: Uuid
        required: true

    entities:
      - name: ProductImage
        relationship: composition
        cardinality: oneToMany
        properties:
          - name: id
            type: Uuid
            required: true
            readOnly: true
            defaultValue: generated
          - name: url
            type: Url
            required: true
          - name: type
            type: ImageType
            required: true

    domainMethods:
      - name: create
        signature: "create(sku, name, price, categoryId): Product"
        description: Factory method to create a new product in DRAFT state.
        returns: Product

      - name: activate
        signature: "activate(): void"
        description: Transitions the product to ACTIVE status.
        returns: void
        emits: ProductActivated

      - name: updatePrice
        signature: "updatePrice(newPrice: Money): void"
        description: Replaces the current price with a new one.
        returns: void
        emits: ProductPriceChanged

    domainRules:
      - id: PRD-RULE-001
        type: statePrecondition
        description: A product can only be activated if it is in DRAFT state.
        errorCode: PRODUCT_CANNOT_BE_ACTIVATED

      - id: PRD-RULE-002
        type: uniqueness
        description: SKU must be unique across all products.
        field: sku
        errorCode: PRODUCT_SKU_ALREADY_EXISTS
        constraintName: uk_product_sku
```

---

## 2. Propiedades del agregado raíz

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | PascalCase | ✅ | Nombre del agregado. Clase raíz Java y prefijo de todas las clases generadas. |
| `root` | PascalCase | ✅ | Entidad raíz del agregado. Casi siempre igual a `name`. |
| `auditable` | boolean | no | Si `true`, la entidad JPA extiende `FullAuditableEntity` y tiene columnas `created_at`, `updated_at`. Default: `false`. |
| `softDelete` | boolean | no | Si `true`, la entidad JPA tiene `@SQLRestriction("deleted_at IS NULL")` y la columna `deleted_at`. Las queries estándar filtran automáticamente los registros eliminados. Default: `false`. |
| `readModel` | boolean | no | Si `true`, el agregado es un read model actualizado por eventos de otro BC. Requiere `sourceBC` y `sourceEvents`. |
| `sourceBC` | kebab-case | ✅ si readModel | BC origen del read model. Solo para agregados read model. |
| `sourceEvents` | lista PascalCase | ✅ si readModel | Eventos que actualizan este read model. |
| `properties` | lista | ✅ (mínimo 1) | Campos del agregado raíz. |
| `entities` | lista | no | Entidades hijas del agregado. |
| `domainMethods` | lista | no | Métodos de negocio del agregado. |
| `domainRules` | lista | no | Invariantes y restricciones del dominio. |

---

## 3. Propiedades individuales (`properties`)

Cada propiedad del agregado raíz o de una entidad hija acepta:

```yaml
properties:
  - name: id
    type: Uuid
    required: true
    readOnly: true
    defaultValue: generated    # UUID v4 generado en factory, excluido del constructor de creación

  - name: sku
    type: String(50)
    required: true
    indexed: true              # genera @Index en la entidad JPA
    unique: true               # genera @Column(unique=true) en JPA

  - name: displayOrder
    type: Integer
    required: false
    default: 0                 # valor por defecto en el constructor de creación

  - name: deletedAt
    type: DateTime
    required: false
    hidden: true               # excluido de DTOs de respuesta

  - name: categoryId
    type: Uuid
    required: true
    source: body               # de dónde viene en el input del use case

  - name: price
    type: Decimal
    precision: 19
    scale: 4
    required: true
    validations:
      - positive: true
```

### Tabla de atributos de una propiedad

| Atributo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | camelCase | ✅ | Nombre del campo. Se convierte a `snake_case` para la columna JPA. |
| `type` | tipo canónico | ✅ | Tipo del campo. Ver Parte 1 §5. Tipos prohibidos: `string`, `int`, `bool`, etc. |
| `required` | boolean | no | Si `true`: `nullable=false` en JPA y `Objects.requireNonNull` en el constructor. Default: `false`. |
| `readOnly` | boolean | no | Si `true` y `defaultValue: generated`: el campo es `UUID.randomUUID()` en la factory, sin setter ni parámetro en constructor de creación. |
| `defaultValue` | `generated` | no | Solo válido combinado con `readOnly: true`. Indica que el UUID se genera automáticamente en la factory. |
| `default` | valor primitivo | no | Valor por defecto asignado en el constructor cuando el parámetro no se provee (para campos opcionales). |
| `indexed` | boolean | no | Si `true`: genera `@Index` en la entidad JPA. |
| `unique` | boolean | no | Si `true`: genera `@Column(unique=true)` en JPA. No reemplaza una domainRule `type: uniqueness` — son complementarios. |
| `hidden` | boolean | no | Si `true`: el campo se excluye de los DTOs de respuesta y no tiene getter en el DTO. |
| `source` | `body` \| `path` \| `query` \| `authContext` \| `header` \| `multipart` | no | Origen del valor en el contexto de un use case. No afecta la generación del agregado en sí, pero puede ser usado como hint por el handler. |
| `precision` | integer | ✅ si `Decimal` | Precisión total del decimal. Determina `@Column(precision=P)` en JPA. |
| `scale` | integer | ✅ si `Decimal` | Dígitos decimales. Determina `@Column(scale=S)` en JPA. |
| `validations` | lista | no | Restricciones de validación. Ver Parte 1 §5.2. |
| `description` | texto | no | Solo referencia. |

### Código Java generado — entidad de dominio

Para el agregado `Product` con `auditable: true`:

**`Product.java`** (clase de dominio — sin Lombok, sin setters):
```java
package com.canastaShop.catalog.domain.aggregate;

import java.util.UUID;
import java.time.Instant;
import java.util.Objects;
import com.canastaShop.catalog.domain.enums.ProductStatus;
import com.canastaShop.catalog.domain.valueObjects.Money;

public class Product {

    private final UUID id;
    private String sku;
    private String name;
    private ProductStatus status;
    private Money price;
    private UUID categoryId;

    // Audit fields (injected by FullAuditableEntity contract, not declared here)
    private Instant createdAt;
    private Instant updatedAt;

    // ── Constructor de reconstrucción (todos los campos — usado por el mapper JPA→dominio) ──
    public Product(UUID id, String sku, String name, ProductStatus status,
                   Money price, UUID categoryId, Instant createdAt, Instant updatedAt) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.sku = Objects.requireNonNull(sku, "sku must not be null");
        this.name = Objects.requireNonNull(name, "name must not be null");
        if (name != null && name.length() < 3) {
            throw new IllegalArgumentException("name must be at least 3 characters long");
        }
        this.status = Objects.requireNonNull(status, "status must not be null");
        this.price = Objects.requireNonNull(price, "price must not be null");
        this.categoryId = Objects.requireNonNull(categoryId, "categoryId must not be null");
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    // ── Factory method estático (constructor de creación — sin id ni audit fields) ──
    public static Product create(String sku, String name, Money price, UUID categoryId) {
        return new Product(
            UUID.randomUUID(),  // ← readOnly: true + defaultValue: generated
            sku,
            name,
            ProductStatus.DRAFT,  // ← estado inicial inferido del enum de ciclo de vida
            price,
            categoryId,
            null,
            null
        );
    }

    // ── Getters ──
    public UUID getId() { return id; }
    public String getSku() { return sku; }
    public String getName() { return name; }
    public ProductStatus getStatus() { return status; }
    public Money getPrice() { return price; }
    public UUID getCategoryId() { return categoryId; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }

    // ── Métodos de negocio (sin setters públicos) ──
    public void activate() {
        this.status = ProductStatus.ACTIVE;
    }

    public void updatePrice(Money newPrice) {
        Objects.requireNonNull(newPrice, "newPrice must not be null");
        this.price = newPrice;
    }
}
```

### Código Java generado — entidad JPA

**`ProductJpa.java`** (entidad de infraestructura — con Lombok, extiende `FullAuditableEntity`):
```java
package com.canastaShop.catalog.infrastructure.persistence.entities;

import jakarta.persistence.*;
import lombok.*;
import java.util.UUID;
import java.math.BigDecimal;
import com.canastaShop.catalog.domain.enums.ProductStatus;
import com.canastaShop.shared.infrastructure.persistence.FullAuditableEntity;

@Entity
@Table(
    name = "product",
    indexes = {
        @Index(name = "idx_product_sku", columnList = "sku")
    }
)
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class ProductJpa extends FullAuditableEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "sku", length = 50, nullable = false, unique = true)
    private String sku;

    @Column(name = "name", length = 200, nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private ProductStatus status;

    // Money VO expandido en dos columnas
    @Column(name = "price_amount", precision = 19, scale = 4, nullable = false)
    private BigDecimal priceAmount;

    @Column(name = "price_currency", length = 3, nullable = false)
    private String priceCurrency;

    @Column(name = "category_id", nullable = false)
    private UUID categoryId;

    @OneToMany(
        cascade = CascadeType.ALL,
        orphanRemoval = true,
        fetch = FetchType.LAZY
    )
    @JoinColumn(name = "product_id")
    private List<ProductImageJpa> images = new ArrayList<>();
}
```

---

## 4. Entidades hijas (`entities`)

Las entidades hijas son tipos con identidad propia que viven dentro del límite del
agregado. A diferencia de los VOs, tienen un `id` propio.

```yaml
entities:
  - name: ProductImage
    relationship: composition   # o: aggregation
    cardinality: oneToMany      # o: oneToOne
    properties:
      - name: id
        type: Uuid
        required: true
        readOnly: true
        defaultValue: generated
      - name: url
        type: Url
        required: true
      - name: type
        type: ImageType
        required: true
      - name: displayOrder
        type: Integer
        required: false
        default: 0
```

### Propiedades de una entidad hija

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | PascalCase | ✅ | Nombre de la entidad. Genera `{Name}.java` (dominio) y `{Name}Jpa.java` (infraestructura). |
| `relationship` | `composition` \| `aggregation` | no | Tipo de relación con el agregado raíz. |
| `cardinality` | `oneToMany` \| `oneToOne` | no | Cardinalidad. Determina la anotación JPA. |
| `properties` | lista | ✅ | Propiedades de la entidad. Mismas reglas que las propiedades del agregado raíz. |

### Diferencia entre `composition` y `aggregation`

| `relationship` | JPA generado | Comportamiento |
|---|---|---|
| `composition` | `@OneToMany(cascade = CascadeType.ALL, orphanRemoval = true)` | Las entidades hijas no existen sin el padre. Se eliminan automáticamente. |
| `aggregation` | `@OneToMany(cascade = { CascadeType.PERSIST, CascadeType.MERGE }, orphanRemoval = false)` | Las entidades hijas pueden existir independientemente. |

### Código Java generado — entidad hija de dominio

**`ProductImage.java`:**
```java
package com.canastaShop.catalog.domain.models.entities;

import java.util.UUID;
import java.net.URI;
import java.util.Objects;
import com.canastaShop.catalog.domain.enums.ImageType;

public class ProductImage {

    private final UUID id;
    private URI url;
    private ImageType type;
    private Integer displayOrder;

    // Constructor de reconstrucción
    public ProductImage(UUID id, URI url, ImageType type, Integer displayOrder) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.url = Objects.requireNonNull(url, "url must not be null");
        this.type = Objects.requireNonNull(type, "type must not be null");
        this.displayOrder = displayOrder != null ? displayOrder : 0;
    }

    // Factory method
    public static ProductImage create(URI url, ImageType type) {
        return new ProductImage(UUID.randomUUID(), url, type, 0);
    }

    public UUID getId() { return id; }
    public URI getUrl() { return url; }
    public ImageType getType() { return type; }
    public Integer getDisplayOrder() { return displayOrder; }
}
```

**`ProductImageJpa.java`:**
```java
@Entity
@Table(name = "product_image")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class ProductImageJpa {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "url", columnDefinition = "TEXT", nullable = false)
    private String url;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", nullable = false)
    private ImageType type;

    @Column(name = "display_order")
    private Integer displayOrder;
}
```

---

## 5. Métodos de dominio (`domainMethods`)

Los métodos de dominio representan las operaciones de negocio que pueden realizarse
sobre el agregado. El generador usa esta declaración para generar los métodos Java en
la clase de dominio y para asociarlos con los use cases que los invocan.

```yaml
domainMethods:

  # Método factory (obligatorio si hay use cases de tipo command con method: create)
  - name: create
    signature: "create(sku, name, price, categoryId): Product"
    description: Factory method to create a new product in DRAFT state.
    returns: Product

  # Método de transición de estado simple
  - name: activate
    signature: "activate(): void"
    description: Transitions the product from DRAFT to ACTIVE.
    returns: void
    emits: ProductActivated

  # Método con parámetros
  - name: updatePrice
    signature: "updatePrice(newPrice: Money): void"
    description: Replaces the current price.
    returns: void
    emits: ProductPriceChanged

  # Método con múltiples parámetros y opcional
  - name: addImage
    signature: "addImage(url: Url, type: ImageType, displayOrder?): void"
    description: Adds a new image to the product.
    returns: void

  # Método de eliminación (sin parámetros)
  - name: removeImage
    signature: "removeImage(imageId: Uuid): void"
    description: Removes an image from the product by its id.
    returns: void

  # Método que emite múltiples eventos (S22)
  - name: discontinue
    signature: "discontinue(): void"
    description: Permanently retires the product.
    returns: void
    emits:
      - ProductDiscontinued
      - ProductRemovedFromCatalog
```

### Propiedades de un método de dominio

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | camelCase | ✅ | Nombre del método Java. |
| `signature` | string | ✅ | Firma completa en notación DSL: `methodName(param1, param2?: TypeHint): ReturnType`. |
| `description` | texto | no | Propósito del método. |
| `returns` | tipo | ✅ si `name: create` | Para el factory, debe ser el nombre del agregado. Para el resto es `void` usualmente. |
| `emits` | PascalCase \| lista | no | Evento(s) de dominio emitidos al completar el método. Debe(n) estar en `domainEvents.published`. |

### Sintaxis de `signature`

La firma sigue el patrón: `methodName(param1, param2?: TypeHint, ...): ReturnType`

- **Parámetros opcionales:** se marcan con `?` (e.g. `displayOrder?`)
- **Hint de tipo:** se especifica con `:` (e.g. `newPrice: Money`). Sin hint, el generador
  resuelve el tipo buscando una propiedad del mismo nombre en el agregado.
- **Parámetros anidados:** para tipos con paréntesis como `String(200)`, el parser
  maneja correctamente los paréntesis anidados.
- **Sin parámetros:** se omiten los paréntesis o se usa `()`.

### Caso especial: `name: create`

El método `create` tiene una regla obligatoria (validación S23): **`returns` debe ser el
nombre del agregado**. Sin esta declaración la build falla:

```
[bc-yaml-reader] domainMethod "create" in aggregate "Product" must have
returns: Product (got "void").
```

El generador produce el método `create` como **método estático de fábrica** (static factory):

```java
public static Product create(String sku, String name, Money price, UUID categoryId) {
    Product product = new Product(
        UUID.randomUUID(), sku, name, ProductStatus.DRAFT, price, categoryId, null, null
    );
    product.raise(new ProductCreated(product.getId(), ...)); // si emits está declarado
    return product;
}
```

### Emisión de eventos con `emits`

Cuando un método declara `emits`, el generador añade una llamada `raise(new EventName(...))`
dentro del método de dominio. Los campos del evento se resuelven buscando coincidencias
por nombre con las propiedades del agregado:

**`ProductActivated` con payload:**
```yaml
# En domainEvents.published:
- name: ProductActivated
  payload:
    - name: productId
      type: Uuid
      source: aggregate    # ← tomado de this.getId()
    - name: activatedAt
      type: DateTime
      source: timestamp    # ← Instant.now()
```

Genera en `activate()`:
```java
public void activate() {
    this.status = ProductStatus.ACTIVE;
    raise(new ProductActivated(
        this.getId(),
        Instant.now()
    ));
}
```

### Lista de emits (S22)

Cuando un método emite múltiples eventos:
```yaml
emits:
  - ProductDiscontinued
  - ProductRemovedFromCatalog
```

Genera:
```java
public void discontinue() {
    this.status = ProductStatus.DISCONTINUED;
    raise(new ProductDiscontinued(this.getId(), Instant.now()));
    raise(new ProductRemovedFromCatalog(this.getId(), Instant.now()));
}
```

---

## 6. Reglas de dominio (`domainRules`)

Las reglas de dominio son invariantes declarativas que el generador convierte en guardas
Java dentro de los handlers de use cases. Cada tipo produce código diferente.

### 6.1 Tipo `statePrecondition`

**Problema que resuelve:** un use case solo puede ejecutarse si el agregado está en un
estado válido. Sin esta regla, el handler tendría que verificar el estado manualmente
en cada lugar donde se invoque.

```yaml
domainRules:
  - id: PRD-RULE-001
    type: statePrecondition
    description: A product can only be activated if it is in DRAFT state.
    errorCode: PRODUCT_CANNOT_BE_ACTIVATED
```

**Código Java generado** (en el handler del use case que referencia esta regla):
```java
// TODO domainRule(PRD-RULE-001, statePrecondition): A product can only be activated if it is in DRAFT state.
//      Enforce the precondition on product before invoking the domain method:
//      if (!(<invariant on product>)) throw new ProductCannotBeActivatedError();
```

> La regla `statePrecondition` genera siempre un TODO enriquecido con el nombre de la clase
> de error a lanzar. La condición concreta (e.g. `product.getStatus() != ProductStatus.DRAFT`)
> debe ser completada en Fase 3, ya que requiere conocimiento de la lógica de negocio específica.

### 6.2 Tipo `uniqueness`

**Problema que resuelve:** garantiza que un campo es único a nivel de sistema. La
violación de una constraint UNIQUE en la base de datos lanza una excepción técnica que
se debe mapear a un error de dominio. Con `constraintName`, el `HandlerExceptions`
convierte la `DataIntegrityViolationException` en el error declarado.

```yaml
  - id: PRD-RULE-002
    type: uniqueness
    description: SKU must be unique across all products.
    field: sku
    errorCode: PRODUCT_SKU_ALREADY_EXISTS
    constraintName: uk_product_sku
```

| Sub-atributo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `field` | camelCase | no | Nombre de la propiedad que debe ser única. Habilita guardia proactiva en el handler. |
| `constraintName` | snake_case | no (requiere `field`) | Nombre de la constraint UNIQUE en la BD. Habilita mapeo reactivo de `DataIntegrityViolationException`. |

**Código Java generado** (en el handler, guardia proactiva):
```java
// domainRule(PRD-RULE-002): uniqueness — PRE-CHECK before insert
if (productRepository.findBySku(command.sku()).isPresent()) {
    throw new ProductSkuAlreadyExistsError();
}
```

**Mapeo reactivo** en `HandlerExceptions.java` (generado una vez por sistema):
```java
// derived_from: domainRule(PRD-RULE-002, constraintName=uk_product_sku)
if (cause.getMessage().contains("uk_product_sku")) {
    throw new ProductSkuAlreadyExistsError();
}
```

### 6.3 Tipo `terminalState`

**Problema que resuelve:** ciertos estados son finales — una vez alcanzados, ninguna
operación puede modificar el agregado. Esta regla bloquea cualquier intento de mutación.

```yaml
  - id: PRD-RULE-003
    type: terminalState
    description: A discontinued product cannot be modified.
    errorCode: PRODUCT_IS_DISCONTINUED
```

**Código Java generado** (en los métodos de negocio del agregado que invocan `transitionTo`):
```java
// derived_from: PRD-RULE-003 (terminalState)
try {
    this.status = this.status.transitionTo(ProductStatus.DISCONTINUED);
} catch (InvalidStateTransitionException ex) {
    throw new ProductIsDiscontinuedError();
}
```

> El generador envuelve la llamada a `Enum.transitionTo()` en un try/catch que convierte
> la `InvalidStateTransitionException` genérica en el error de dominio declarado. El guard
> no se emite como sentencia `if` explícita — la validación del estado terminal la realiza
> el propio método `transitionTo()` del enum.

### 6.4 Tipo `deleteGuard`

**Problema que resuelve:** no se puede eliminar un registro que tiene dependientes activos
en otro agregado. Sin esta regla, la BD lanzaría una excepción de integridad referencial
sin mensaje de usuario claro.

```yaml
  - id: CAT-RULE-001
    type: deleteGuard
    description: Cannot delete a category that has active products.
    errorCode: CATEGORY_HAS_ACTIVE_PRODUCTS
    targetAggregate: Product
    targetRepositoryMethod: countActiveByCategoryId
```

| Sub-atributo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `targetAggregate` | PascalCase | ✅ (para código ejecutable) | Agregado que contiene los dependientes. |
| `targetRepositoryMethod` | camelCase | ✅ (para código ejecutable) | Método del repositorio que cuenta los dependientes. |

Si se omiten `targetAggregate` o `targetRepositoryMethod`, el generador produce un TODO:
```java
// TODO domainRule(CAT-RULE-001, deleteGuard): Cannot delete a category that has active products.
//      Declare "targetAggregate" + "targetRepositoryMethod" in the YAML to
//      auto-generate the guard, or emit manually:
//      if (<dependentsRepo>.<countMethod>(category.getId()) > 0) throw new CategoryHasActiveProductsError();
```

**Con ambos declarados**, el generador produce código ejecutable:
```java
// domainRule(CAT-RULE-001): CATEGORY_HAS_ACTIVE_PRODUCTS
if (productRepository.countActiveByCategoryId(category.getId()) > 0) {
    throw new CategoryHasActiveProductsError();
}
```

Y añade el repositorio `ProductRepository` como dependencia del handler de delete.

### 6.5 Tipo `crossAggregateConstraint`

**Problema que resuelve:** una operación solo puede realizarse si un agregado relacionado
(en otro repositorio) está en un estado específico. Ejemplo: no se puede crear un producto
en una categoría que está `INACTIVE`.

```yaml
  - id: PRD-RULE-004
    type: crossAggregateConstraint
    description: Products can only be created in active categories.
    errorCode: PRODUCT_CATEGORY_NOT_ACTIVE
    targetAggregate: Category
    field: categoryId
    expectedStatus: ACTIVE
```

| Sub-atributo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `targetAggregate` | PascalCase | ✅ (junto con `field` y `expectedStatus`) | Agregado a verificar. |
| `field` | camelCase | ✅ | Campo del input del UC que contiene el FK hacia el target. |
| `expectedStatus` | SCREAMING_SNAKE | ✅ | Valor de estado que debe tener el target. |

**Código Java generado** en el handler:
```java
// domainRule(PRD-RULE-004): crossAggregateConstraint
Category category = categoryRepository.findById(command.categoryId())
    .orElseThrow(ProductCategoryNotActiveError::new);
if (category.getStatus() != CategoryStatus.ACTIVE) {
    throw new ProductCategoryNotActiveError();
}
```

Y añade `CategoryRepository` como dependencia del handler.

### 6.6 Tipo `sideEffect`

Declara un efecto secundario conocido del dominio. Actualmente no genera código ejecutable
(produce un TODO enriquecido), pero documenta la intención para la Fase 3.

```yaml
  - id: PRD-RULE-005
    type: sideEffect
    description: >
      Activating a product triggers a price indexation in the search service.
      This is handled via the ProductActivated event consumer.
```

**Código generado:**
```java
// TODO domainRule(PRD-RULE-005, sideEffect): Activating a product triggers a price
//      indexation in the search service. This is handled via the ProductActivated event consumer.
```

### Campos comunes de `domainRules`

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `id` | SCREAMING-KEBAB (`RULE-ID`) | ✅ | Identificador único en el BC. Referenciado por use cases en `rules[]`. |
| `type` | enum | ✅ | Tipo de regla. Valores: `uniqueness`, `statePrecondition`, `terminalState`, `sideEffect`, `deleteGuard`, `crossAggregateConstraint`. |
| `errorCode` | SCREAMING_SNAKE | ✅ para `uniqueness`, `statePrecondition`, `deleteGuard`, `crossAggregateConstraint` | Código del error a lanzar. Debe existir en `errors[]`. |
| `description` | texto | no | Descripción de la regla. |
| `appliesTo` | string | no | Para reglas a nivel de documento (fuera de agregados), el nombre del agregado al que aplica. |

---

## 7. Flags de agregado

### 7.1 `auditable: true`

**Problema que resuelve:** la mayoría de entidades de negocio requieren saber cuándo
fueron creadas y cuándo se modificaron por última vez, para auditoría, debugging y
sincronización incremental.

```yaml
aggregates:
  - name: Product
    root: Product
    auditable: true
```

**Efecto en el código generado:**

- La entidad JPA extiende `FullAuditableEntity` en lugar de `BaseEntity`
- `FullAuditableEntity` tiene `@CreatedDate` y `@LastModifiedDate` gestionados por
  Spring Data JPA `@EntityListeners(AuditingEntityListener.class)`
- Los campos `createdAt` y `updatedAt` **no se declaran** en `properties` del YAML
  (el generador los excluye del constructor si aparecen)

**`FullAuditableEntity.java`** (generada una vez en shared):
```java
@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
@Getter @Setter
public abstract class FullAuditableEntity {

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @LastModifiedDate
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
```

---

### 7.2 `softDelete: true`

**Problema que resuelve:** algunos agregados no deben eliminarse físicamente — sus datos
históricos son necesarios para auditoría, reportes o recuperación. Con soft delete, la
"eliminación" marca el registro con `deleted_at` pero no lo borra de la BD.

```yaml
aggregates:
  - name: Order
    root: Order
    softDelete: true
    auditable: true
```

**Efecto en el código generado:**

- La entidad JPA también extiende `FullAuditableEntity` (ambos flags pueden combinarse)
- La entidad JPA recibe `@SQLRestriction("deleted_at IS NULL")` — Hibernate aplica este filtro
  automáticamente en todas las queries derivadas de Spring Data. No es necesario un `findActiveById` explícito.
- Se genera el campo `deletedAt` en la entidad JPA
- El repositorio JPA genera automáticamente el método `softDelete(id)` en lugar de `delete(id)`

**`OrderJpa.java`** (fragmento):
```java
@org.hibernate.annotations.SQLRestriction("deleted_at IS NULL")
public class OrderJpa extends FullAuditableEntity {
    // ...
    @Column(name = "deleted_at")
    private Instant deletedAt;
}
```

**`OrderJpaRepository.java`** (fragmento — método auto-generado):
```java
@Modifying
@Transactional
@Query("UPDATE OrderJpa a SET a.deletedAt = CURRENT_TIMESTAMP WHERE a.id = :id AND a.deletedAt IS NULL")
void softDelete(@Param("id") UUID id);
```

> Cuando el agregado también tiene `auditable: true`, la query incluye
> `a.deletedAt = CURRENT_TIMESTAMP, a.updatedAt = CURRENT_TIMESTAMP`
> para mantener el campo `updated_at` sincronizado.

---

### 7.3 `readOnly: true` en propiedades

**Problema que resuelve:** ciertos campos como `id` o `createdBy` no deben poder ser
modificados después de la creación. Sin `readOnly`, cualquier método del agregado podría
sobrescribir el `id`.

```yaml
properties:
  - name: id
    type: Uuid
    required: true
    readOnly: true
    defaultValue: generated
```

**Efectos en el código generado:**
- El campo se declara `final` en la clase de dominio
- Se excluye del constructor de creación (factory method)
- Se genera con `UUID.randomUUID()` si `defaultValue: generated`
- No se genera setter

```java
// Campo final — no modificable
private final UUID id;

// En el constructor de reconstrucción: se acepta el id
public Product(UUID id, ...) { this.id = Objects.requireNonNull(id, "..."); }

// En el factory method: se genera automáticamente
public static Product create(String sku, ...) {
    return new Product(UUID.randomUUID(), ...);  // ← NO hay parámetro id
}
```

---

## 8. Agregados read model

Un agregado read model es una proyección persistente que se actualiza reactivamente
a partir de eventos de dominio de otro BC. A diferencia de las `projections` (que son
shapes de lectura en memoria), un read model tiene su propia tabla en la BD y se puede
consultar con toda la potencia de SQL.

```yaml
aggregates:
  - name: ProductCatalogView
    root: ProductCatalogView
    readModel: true
    sourceBC: catalog
    sourceEvents:
      - ProductActivated
      - ProductPriceChanged
      - ProductDiscontinued
    properties:
      - name: id
        type: Uuid
        required: true
        readOnly: true
        defaultValue: generated
      - name: productId
        type: Uuid
        required: true
      - name: name
        type: String(200)
        required: true
      - name: currentPrice
        type: Money
        required: true
      - name: status
        type: ProductStatus
        required: true
```

### Propiedades de un agregado read model

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `readModel` | boolean | ✅ | Marca el agregado como read model. |
| `sourceBC` | kebab-case | ✅ | BC que produce los eventos de actualización. Validado por INT-010. |
| `sourceEvents` | lista PascalCase | ✅ (mínimo 1) | Eventos que actualizan este read model. Validado por INT-010. |

### Restricciones de validación

- Los use cases de tipo `command` sobre un read model **deben tener** `trigger.kind: event`
  (no pueden ser disparados por HTTP — solo por eventos)
- Los use cases de tipo `query` sobre un read model pueden ser HTTP

### Código Java generado

El generador produce el mismo scaffolding que un agregado normal, más un **listener de
evento** que actualiza el read model:

**`ProductCatalogViewUpdater.java`** (generado por projection-updater-generator):
```java
@Component
public class ProductCatalogViewUpdater {

    private final ProductCatalogViewRepository repository;

    @RabbitListener(queues = "inventory.product-catalog-view.update")
    // o @EventListener (si es mismo BC)
    public void onProductActivated(ProductActivated event) {
        // TODO: implement read model update logic
        // derived_from: sourceBC=catalog, sourceEvent=ProductActivated
        throw new UnsupportedOperationException("Not implemented yet");
    }

    public void onProductPriceChanged(ProductPriceChanged event) {
        // TODO: implement read model update logic
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
```
