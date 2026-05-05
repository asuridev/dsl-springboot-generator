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
7. [Flags de agregado: `auditable`, `softDelete`, `concurrencyControl`, `readOnly`](#7-flags-de-agregado)
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
| `concurrencyControl` | `optimistic` | no | Si `optimistic`, la entidad JPA recibe `@Version Long version`. Hibernate gestiona el incremento automáticamente y lanza `OptimisticLockException` si dos transacciones modifican la misma fila concurrentemente. **No afecta a la clase de dominio.** Cualquier valor distinto de `optimistic` es ignorado silenciosamente (no hay validación en `bc-yaml-reader.js`). Ver §7.4. |
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
| `required` | boolean | no | Si `true`: `nullable=false` en JPA. **No genera `Objects.requireNonNull` en la clase de dominio** — el dominio aplica solo las validaciones de `validations[]`. Default: `false`. |
| `readOnly` | boolean | no | Si `true`: el campo se excluye del constructor de creación y el factory method lo inicializa automáticamente desde `defaultValue`. El campo sigue siendo mutable desde los métodos de negocio del agregado. Debe combinarse con `defaultValue`. |
| `defaultValue` | ver tabla | no | Solo válido combinado con `readOnly: true`. Define el valor que el factory method asigna automáticamente al campo. Ver tabla de valores aceptados abajo. |
| `default` | valor | no | Solo válido en inputs de use case con `source: header`. Genera `@RequestHeader(defaultValue="...")` en el controller. **Ignorado silenciosamente en propiedades de agregados y entidades.** |
| `indexed` | boolean | no | Si `true`: genera `@Index` en la entidad JPA. |
| `unique` | boolean | no | Si `true`: genera `@Column(unique=true)` en JPA. No reemplaza una domainRule `type: uniqueness` — son complementarios. |
| `hidden` | boolean | no | Si `true`: el campo se excluye de los DTOs de respuesta y no tiene getter en el DTO. |
| `source` | `body` \| `path` \| `query` \| `authContext` \| `header` \| `multipart` | no | Origen del valor en el contexto de un use case. No afecta la generación del agregado en sí, pero puede ser usado como hint por el handler. |
| `precision` | integer | ✅ si `Decimal` | Precisión total del decimal. Determina `@Column(precision=P)` en JPA. |
| `scale` | integer | ✅ si `Decimal` | Dígitos decimales. Determina `@Column(scale=S)` en JPA. |
| `validations` | lista | no | Restricciones de validación. Ver Parte 1 §5.2. |
| `description` | texto | no | Solo referencia. |

#### Valores aceptados para `defaultValue`

| Valor | Java generado | Tipo de campo |
|---|---|---|
| `generated` | `UUID.randomUUID()` | `Uuid` |
| `now()` | `java.time.Instant.now()` | `DateTime` |
| `ENUM_VALUE` | `EnumType.ENUM_VALUE` | Enum del BC |
| string literal | `"literal"` | `String` / `String(n)` |
| boolean | `true` / `false` | `Boolean` |
| número entero (e.g. `0`) | `0` | `Integer` / `Long` |
| número decimal (e.g. `0`) | `new BigDecimal("0")` | `Decimal` |

### Código Java generado — entidad de dominio

Para el agregado `Product` con `auditable: true`:

**`Product.java`** (clase de dominio — sin Lombok, sin setters):
```java
package com.canastaShop.catalog.domain.aggregate;

import java.time.Instant;
import java.util.UUID;
import com.canastaShop.catalog.domain.enums.ProductStatus;
import com.canastaShop.catalog.domain.valueobject.Money;

public class Product {

    private final UUID id;
    private String sku;
    private String name;
    private ProductStatus status;
    private Money price;
    private UUID categoryId;

    // Audit fields
    private Instant createdAt;
    private Instant updatedAt;

    // ── Constructor de reconstrucción (todos los campos — usado por el mapper JPA→dominio) ──
    // Asignación directa sin null-checks: los datos vienen ya validados de la BD.
    public Product(UUID id, String sku, String name, ProductStatus status,
                   Money price, UUID categoryId, Instant createdAt, Instant updatedAt) {
        this.id = id;
        this.sku = sku;
        this.name = name;
        this.status = status;
        this.price = price;
        this.categoryId = categoryId;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    // ── Constructor de creación (PRIVADO — invocado solo por el factory method) ──
    // Aquí se ejecutan las validaciones de dominio (validations[]).
    private Product(String sku, String name, Money price, UUID categoryId) {
        if (name != null && name.length() < 3) {
            throw new IllegalArgumentException("name must be at least 3 characters long");
        }
        this.id = UUID.randomUUID();   // ← readOnly: true + defaultValue: generated
        this.sku = sku;
        this.name = name;
        this.price = price;
        this.categoryId = categoryId;
        this.status = ProductStatus.DRAFT;  // ← readOnly: true + defaultValue: DRAFT (autoInit)
    }

    // ── Factory method estático (sin id ni status como parámetros — los asigna el ctor privado) ──
    /** derived_from: UC-CREATE-PRODUCT Crear producto */
    public static Product create(String sku, String name, Money price, UUID categoryId) {
        Product instance = new Product(sku, name, price, categoryId);
        return instance;
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
    /** derived_from: UC-ACTIVATE-PRODUCT Activar producto */
    public void activate() {
        this.status = ProductStatus.ACTIVE;
    }

    /** derived_from: UC-UPDATE-PRICE Actualizar precio */
    public void updatePrice(Money newPrice) {
        this.price = newPrice;
    }

    // ── Identity equality ──
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Product that = (Product) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() { return java.util.Objects.hash(this.id); }

    @Override
    public String toString() { return "Product{id=" + this.id + "}"; }
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
package com.canastaShop.catalog.domain.entity;

import java.net.URI;
import java.util.UUID;
import com.canastaShop.catalog.domain.enums.ImageType;

public class ProductImage {

    private final UUID id;
    private URI url;
    private ImageType type;
    private Integer displayOrder;

    // Constructor de reconstrucción — asignación directa, sin null-checks
    public ProductImage(UUID id, URI url, ImageType type, Integer displayOrder) {
        this.id = id;
        this.url = url;
        this.type = type;
        this.displayOrder = displayOrder;
    }

    // Constructor de creación (PÚBLICO — entidades hijas no tienen static factory)
    // id se genera aquí; displayOrder es opcional (required: false) y se pasa como parámetro
    public ProductImage(URI url, ImageType type, Integer displayOrder) {
        this.id = UUID.randomUUID();
        this.url = url;
        this.type = type;
        this.displayOrder = displayOrder;
    }

    public UUID getId() { return id; }
    public URI getUrl() { return url; }
    public ImageType getType() { return type; }
    public Integer getDisplayOrder() { return displayOrder; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        ProductImage that = (ProductImage) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() { return java.util.Objects.hash(this.id); }

    @Override
    public String toString() { return "ProductImage{id=" + this.id + "}"; }
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
/** derived_from: UC-CREATE-PRODUCT Crear producto */
public static Product create(String sku, String name, Money price, UUID categoryId) {
    Product instance = new Product(sku, name, price, categoryId);  // ← llama al ctor PRIVADO de creación
    // instance.raise(new ProductCreated(...)); // si emits está declarado
    return instance;
}
// Dentro del constructor PRIVADO de creación:
//   this.id = UUID.randomUUID();          ← defaultValue: generated
//   this.status = ProductStatus.DRAFT;    ← defaultValue: DRAFT (autoInit)
```

> **Clave**: el UUID y los campos `readOnly + defaultValue` se asignan dentro del
> **constructor privado de creación**, no en el factory method. El factory solo
> recibe los parámetros de negocio que el cliente debe proveer.

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
está en un estado específico. Ejemplo: no se puede crear un `Product` en una `Category`
que está `INACTIVE`.

#### Restricción DDD: solo válido dentro del mismo BC

`crossAggregateConstraint` **solo es aplicable cuando `targetAggregate` pertenece al mismo
Bounded Context** que el agregado que declara la regla. En DDD, un agregado nunca debe
cargar una instancia completa de otro agregado de otro BC — eso crearía acoplamiento
fuerte entre contextos.

| Escenario | Mecanismo correcto |
|---|---|
| `Category` y `Product` en el **mismo BC** | `crossAggregateConstraint` → el generador inyecta `CategoryRepository` en el handler |
| `Category` en otro BC | No usar esta regla. Declarar una integración `outbound` + un use case con `fkValidations` o un `crossAggregateConstraint` sin hints (TODO manual) |

> **Nota sobre agregados de solo lectura:** La única excepción aceptable en DDD para
> acceder a un repositorio de otro agregado (incluso de otro BC) es cuando ese agregado
> es un **read model** (`readModel: true`) que este BC mantiene localmente como proyección
> de eventos. En ese caso el acceso es de consulta pura y no viola el invariante de
> consistencia transaccional del BC origen.

#### Sub-atributos

| Sub-atributo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `targetAggregate` | PascalCase | no* | Nombre del agregado a verificar. **Debe existir en `aggregates[]` del mismo BC.** El generador lo busca en `bcYaml.aggregates` en tiempo de generación — si no lo encuentra emite un TODO. |
| `field` | camelCase | no* | Nombre del campo en `useCases[].input[]` que lleva el FK hacia el target. El generador lo busca en los inputs del UC en tiempo de generación — si no lo encuentra emite un TODO. **`bc-yaml-reader.js` no valida esto en tiempo de parsing.** |
| `expectedStatus` | SCREAMING_SNAKE | no* | Valor del enum de estado que debe tener el target. El generador resuelve el enum buscando la primera propiedad del target cuyo **tipo** termine en `Status` (ej. `CategoryStatus`, `OrderStatus`). |

\* Los tres atributos son opcionales individualmente, pero deben declararse **todos juntos o ninguno**.
`bc-yaml-reader.js` rechaza declarar uno o dos de los tres — falla en tiempo de parsing.
Si se omiten todos, el generador produce un TODO enriquecido en lugar de código ejecutable.

#### YAML con los tres hints — código ejecutable

```yaml
  - id: PRD-RULE-004
    type: crossAggregateConstraint
    description: Products can only be created in active categories.
    errorCode: PRODUCT_CATEGORY_NOT_ACTIVE
    targetAggregate: Category    # debe estar en aggregates[] del mismo BC
    field: categoryId            # nombre del campo en input[] del UC que lleva el FK
    expectedStatus: ACTIVE       # valor del enum *Status del target (ej. CategoryStatus.ACTIVE)
```

**Código Java generado** en el handler:
```java
// domainRule(PRD-RULE-004): PRODUCT_CATEGORY_NOT_ACTIVE
Category category = categoryRepository
    .findById(UUID.fromString(command.categoryId()))
    .orElseThrow(ProductCategoryNotActiveError::new);
if (category.getStatus() != CategoryStatus.ACTIVE) {
    throw new ProductCategoryNotActiveError();
}
```

Donde:
- El getter (`getStatus()`) se deriva del nombre de la propiedad cuyo tipo termina en `Status`
- `CategoryRepository` se importa desde `{package}.{bc}.domain.repository.CategoryRepository` — es decir, el repositorio del BC actual, no de otro BC
- El generador añade `CategoryRepository` como dependencia inyectada del handler e importa `Category`, `CategoryStatus` y `ProductCategoryNotActiveError`

#### YAML sin hints — TODO enriquecido

```yaml
  - id: PRD-RULE-004
    type: crossAggregateConstraint
    description: Products can only be created in active categories.
    errorCode: PRODUCT_CATEGORY_NOT_ACTIVE
    # sin targetAggregate / field / expectedStatus
```

**Código Java generado:**
```java
// TODO domainRule(PRD-RULE-004, crossAggregateConstraint): Products can only be created in active categories.
//      Declare "targetAggregate" + "field" + "expectedStatus" in the YAML to
//      auto-generate the guard, or emit manually:
//      if (<targetVar>.getStatus() != <Enum>.<EXPECTED>) throw new ProductCategoryNotActiveError();
```

#### TODOs de fallback en generación

Cuando los hints están declarados pero el generador no puede resolver los datos necesarios,
emite un TODO específico en lugar de código roto:

| Causa | TODO generado |
|---|---|
| `targetAggregate` no existe en `aggregates[]` del BC | `// TODO domainRule(PRD-RULE-004): targetAggregate "Category" not found in current BC` |
| El target no tiene ninguna propiedad de tipo `*Status` | `// TODO domainRule(PRD-RULE-004): no <Aggregate>Status property found on Category` |
| `field` no existe en `input[]` del UC | `// TODO domainRule(PRD-RULE-004): input field "categoryId" not found in UC inputs` |

El primer caso es el más frecuente cuando se intenta usar `crossAggregateConstraint` con un
agregado de otro BC — el generador lo detecta y aborta la generación del guard sin error fatal.

### 6.6 Tipo `sideEffect`

Declara un efecto secundario conocido del dominio. **El generador no produce ningún código
ejecutable ni comentario** para este tipo de regla en los handlers — la regla es intencionalmente
inerte en `domain-rule-mapper.js` (`return emptyResult()`).

```yaml
  - id: PRD-RULE-005
    type: sideEffect
    description: >
      Activating a product triggers a price indexation in the search service.
      This is handled via the ProductActivated event consumer.
```

**Código generado:** ninguno. La `description` sirve como documentación del diseño para
Fase 3 — el implementador sabe que el efecto secundario existe sin necesidad de un TODO
en el código.

> Si el efecto secundario se implementa vía evento de dominio, declara `emits` en el
> `domainMethod` correspondiente para que el generador emita la llamada `raise(...)`.
> Si se implementa en el handler como llamada a otro servicio, codificarlo manualmente en Fase 3.

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

### 7.3 `concurrencyControl: optimistic`

**Problema que resuelve:** cuando múltiples transacciones concurrentes pueden modificar
la misma instancia del agregado (alta contención), el bloqueo optimista detecta escrituras
conflictivas y lanza una excepción que el llamador puede reintentar. Sin esta guardia,
la última escritura silenciosamente sobreescribiría las anteriores.

```yaml
aggregates:
  - name: Category
    root: Category
    auditable: true
    concurrencyControl: optimistic   # ← opt-in
    properties:
      - name: name
        type: String
```

**Efecto en el código generado:**

Únicamente en la entidad JPA — `{Name}Jpa.java` recibe el campo `version` con `@Version`:

```java
@Version
@Column(name = "version", nullable = false)
private Long version;
```

Hibernate gestiona este campo automáticamente:
- Se inicializa a `0` en el primer `INSERT`
- Se incrementa en cada `UPDATE`
- Si la versión en el `UPDATE` no coincide con la almacenada, Hibernate lanza `OptimisticLockException`

**Lo que NO cambia:**
- La clase de dominio (`{Name}.java`) no recibe el campo `version`
- Los DTOs de respuesta no exponen `version`
- El repositorio JPA no requiere cambios
- `bc-yaml-reader.js` no valida este campo — cualquier valor distinto de `optimistic` es ignorado sin error

**Cuándo usarlo:**
- Agregados con alta competencia entre comandos concurrentes sobre la misma instancia
- Agregados que participan en sagas o procesos largos donde una lectura previa puede quedar obsoleta

---

### 7.4 `readOnly: true` en propiedades

**Problema que resuelve:** ciertos campos como `id`, `registeredAt` o `status` no
deben ser asignados por el cliente en el momento de la creación — su valor inicial
lo determina el sistema automáticamente. Sin `readOnly`, estos campos serían parámetros
del factory method y el llamador podría pasar cualquier valor.

Siempre se combina con `defaultValue`. Los valores aceptados son:

| `defaultValue` | Java en factory | Tipo típico |
|---|---|---|
| `generated` | `UUID.randomUUID()` | `Uuid` — para `id` |
| `now()` | `java.time.Instant.now()` | `DateTime` — para timestamps de creación |
| `ENUM_VALUE` | `EnumType.ENUM_VALUE` | Enum — para estado inicial fijo |
| string / boolean | literal Java | `String`, `Boolean` |
| número entero (e.g. `0`) | `0` | `Integer` / `Long` |
| número decimal (e.g. `0`) | `new BigDecimal("0")` | `Decimal` |

```yaml
properties:
  - name: id
    type: Uuid
    required: true
    readOnly: true
    defaultValue: generated       # UUID.randomUUID() en factory

  - name: registeredAt
    type: DateTime
    required: true
    readOnly: true
    defaultValue: now()           # Instant.now() en factory

  - name: status
    type: OrderStatus
    required: true
    readOnly: true
    defaultValue: PENDING         # OrderStatus.PENDING en factory
```

**Efectos en el código generado:**
- Se excluye del constructor de creación (factory method)
- El factory method asigna el valor automáticamente según `defaultValue`
- El campo sigue siendo mutable desde los métodos de negocio del agregado (e.g. `activate()` puede reasignar `status`)

```java
private final UUID id;    // id es siempre final — hardcodeado en template, independiente de readOnly
private Instant registeredAt;
private OrderStatus status;

// En el constructor de reconstrucción: asignación directa, sin null-checks
public Order(UUID id, Instant registeredAt, OrderStatus status, ...) {
    this.id = id;
    this.registeredAt = registeredAt;
    this.status = status;
    ...
}

// En el constructor PRIVADO de creación: ninguno de estos es parámetro
private Order(...) {
    this.id = UUID.randomUUID();          // ← defaultValue: generated
    this.registeredAt = java.time.Instant.now();    // ← defaultValue: now()
    this.status = OrderStatus.PENDING;    // ← defaultValue: PENDING
    ...
}

// El factory method estático llama al constructor privado de creación
public static Order create(...) {
    Order instance = new Order(...);
    return instance;
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
