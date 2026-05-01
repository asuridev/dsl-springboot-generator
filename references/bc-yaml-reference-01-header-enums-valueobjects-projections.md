# Referencia de `{bc}.yaml` — Parte 1: Cabecera, Enums, Value Objects y Projections

Este documento cubre las primeras cuatro secciones del archivo táctico de un Bounded
Context. Para las secciones restantes consultar:

- [Parte 2: Aggregates](./bc-yaml-reference-02-aggregates.md)
- [Parte 3: Use Cases](./bc-yaml-reference-03-usecases.md)
- [Parte 4: Repositories y Errors](./bc-yaml-reference-04-repositories-errors.md)
- [Parte 5: Integrations y Domain Events](./bc-yaml-reference-05-integrations-events.md)

---

## Tabla de contenidos

1. [Cabecera del BC](#1-cabecera-del-bc)
2. [Sección `enums`](#2-sección-enums)
3. [Sección `valueObjects`](#3-sección-valueobjects)
4. [Sección `projections`](#4-sección-projections)
5. [Tipos canónicos disponibles](#5-tipos-canónicos-disponibles)

---

## 1. Cabecera del BC

```yaml
bc: catalog
type: core
description: >
  Manages the lifecycle of products and categories, from initial draft creation
  through activation, price changes, and final discontinuation.
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `bc` | kebab-case | ✅ | Debe coincidir exactamente con el `name` del BC en `system.yaml` y con el nombre del directorio `arch/{bc}/`. El generador usa este valor como nombre de módulo Java y como prefijo de paquete. |
| `type` | `core` \| `supporting` \| `generic` | no | Clasificación DDD del BC. Solo referencia. |
| `description` | texto (inglés) | no | 1–2 oraciones que describen qué gestiona este BC. Solo referencia. |

### Problema que resuelve `bc`

El campo `bc` es el eje central de la generación. Controla:

1. **Nombre del módulo Java:** `{pkg}.catalog.domain.aggregate.Product`
2. **Ruta de salida:** `src/main/java/{pkg}/catalog/...`
3. **Validación cruzada INT-006:** el generador verifica que `outbound[].name` tenga una
   integración recíproca en `system.yaml` usando este identificador.

Si `bc: catalog` difiere de la carpeta `arch/catalogo/`, el lector de YAML fallará con:
```
[bc-yaml-reader] BC YAML not found: arch/catalogo/catalogo.yaml
```

---

## 2. Sección `enums`

Los enums declaran tipos con un conjunto cerrado de valores. Hay dos variantes:

- **Enum de ciclo de vida:** modela transiciones de estado con reglas de dominio
- **Enum de clasificación:** conjunto estático de valores sin transiciones

### 2.1 Enum de ciclo de vida (estados)

**Problema que resuelve:** sin modelar las transiciones en el YAML, el generador no
puede producir el método de estado en el agregado ni detectar automáticamente el estado
objetivo de un use case. Con las transiciones declaradas, el generador infiere la
asignación `entity.setStatus(ProductStatus.ACTIVE)` dentro del handler.

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
            condition: PRD-RULE-001
            rules: [PRD-RULE-001, PRD-RULE-002]
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
        transitions: []
```

#### Campos de un valor de enum

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `value` | SCREAMING_SNAKE_CASE | ✅ | Valor del enum. Se convierte en literal Java. |
| `description` | texto | no | Descripción del estado. |
| `transitions` | lista | no | Transiciones válidas desde este estado. |

#### Campos de una transición

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `to` | SCREAMING_SNAKE_CASE | ✅ | Estado destino. Debe ser otro `value` del mismo enum. |
| `triggeredBy` | `{UC-ID} {NombreUC}` | ✅ | Use case que dispara la transición. El generador lee el ID para detectar automáticamente el estado objetivo. |
| `condition` | `{RULE-ID}` o `none` | ✅ | La regla que actúa como puerta de entrada. `none` significa que la transición siempre es válida desde este estado. |
| `rules` | lista de RULE-ID | no | Todas las reglas evaluadas en este use case (incluye `condition` más reglas adicionales). |
| `emits` | PascalCase o `null` | no | Evento de dominio emitido al completar la transición. |

#### Código Java generado

**`ProductStatus.java`:**
```java
package com.canastaShop.catalog.domain.enums;

public enum ProductStatus {

    DRAFT,
    ACTIVE,
    DISCONTINUED;
}
```

El generador detecta que `UC-PRD-004 ActivateProduct` lleva el agregado a `ACTIVE` y
genera automáticamente en el handler:

**`ActivateProductHandler.java`** (fragmento del método `execute`):
```java
@Override
public void execute(ActivateProductCommand command) {
    Product product = productRepository.findById(command.productId())
        .orElseThrow(ProductNotFoundError::new);

    // domainRule(PRD-RULE-001): statePrecondition
    if (product.getStatus() != ProductStatus.DRAFT) {
        throw new ProductCannotBeActivatedError();
    }

    product.activate();     // ← invoca domainMethod con el nombre detectado
    productRepository.save(product);
}
```

---

### 2.2 Enum de clasificación simple

Sin ciclo de vida: solo un conjunto cerrado de valores constantes.

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

**`ImageType.java`:**
```java
package com.canastaShop.catalog.domain.enums;

public enum ImageType {
    MAIN,
    GALLERY,
    THUMBNAIL;
}
```

---

## 3. Sección `valueObjects`

Un Value Object (VO) es un tipo compuesto definido por sus propiedades, sin identidad
propia. Es inmutable: dos VOs con los mismos valores son iguales.

**Problema que resuelve:** evita la dispersión de primitivos. En lugar de tener tres
campos `amount: BigDecimal`, `currency: String`, `originalAmount: BigDecimal` en el
agregado, se modela un solo campo `price: Money`. Garantiza que cantidad y moneda siempre
viajen juntos y que la precisión nunca se pierda.

```yaml
valueObjects:

  - name: Money
    description: >
      Represents an exact monetary amount with its currency. Modeled as a VO to
      guarantee that amount and currency always travel together and that precision
      is never lost through floating-point.
    properties:
      - name: amount
        type: Decimal
        precision: 19
        scale: 4
        required: true
        description: Exact monetary amount.
      - name: currency
        type: String(3)
        required: true
        description: ISO 4217 currency code (e.g. COP, USD, EUR).

  - name: Slug
    description: URL-friendly identifier derived from product name.
    properties:
      - name: value
        type: String(200)
        required: true
        validations:
          - pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$"
        description: Slug value matching URL-safe pattern.
```

### Propiedades de un Value Object

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | PascalCase | ✅ | Nombre del VO. Generado como clase Java inmutable con record o clase final. |
| `description` | texto | no | Por qué existe este VO. |
| `properties` | lista | ✅ (mínimo 1) | Propiedades del VO. Mismas reglas que las propiedades de agregados. |

### Propiedades individuales de un VO

Cada propiedad sigue el mismo esquema que las propiedades de un agregado (ver Parte 2).
Los campos disponibles son:

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | camelCase | ✅ | Nombre del campo Java. |
| `type` | tipo canónico | ✅ | Tipo del campo. Ver §5. |
| `required` | boolean | no | Si `true`, el constructor valida `Objects.requireNonNull`. Default: `false`. |
| `precision` | integer | ✅ si `type: Decimal` | Precisión total del decimal (dígitos totales). |
| `scale` | integer | ✅ si `type: Decimal` | Dígitos decimales. |
| `validations` | lista | no | Restricciones adicionales. Ver §5.2 en Parte 2. |
| `description` | texto | no | Solo referencia. |

### Código Java generado

**`Money.java`:**
```java
package com.canastaShop.catalog.domain.valueObjects;

import java.math.BigDecimal;
import java.util.Objects;

public final class Money {

    private final BigDecimal amount;
    private final String currency;

    public Money(BigDecimal amount, String currency) {
        Objects.requireNonNull(amount, "amount must not be null");
        Objects.requireNonNull(currency, "currency must not be null");
        this.amount = amount;
        this.currency = currency;
    }

    public BigDecimal getAmount() { return amount; }
    public String getCurrency() { return currency; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Money)) return false;
        Money that = (Money) o;
        return Objects.equals(amount, that.amount) && Objects.equals(currency, that.currency);
    }

    @Override
    public int hashCode() {
        return Objects.hash(amount, currency);
    }
}
```

**`MoneyEmbeddable.java`** (para la entidad JPA):
```java
@Embeddable
@Getter @Setter @NoArgsConstructor @AllArgsConstructor
public class MoneyEmbeddable {

    @Column(name = "amount", precision = 19, scale = 4)
    private BigDecimal amount;

    @Column(name = "currency", length = 3)
    private String currency;
}
```

**`Slug.java`** (con validación de pattern):
```java
public final class Slug {

    private final String value;

    public Slug(String value) {
        Objects.requireNonNull(value, "value must not be null");
        if (value != null && !value.matches("^[a-z0-9]+(?:-[a-z0-9]+)*$")) {
            throw new IllegalArgumentException("value does not match required pattern");
        }
        this.value = value;
    }

    public String getValue() { return value; }

    // equals, hashCode...
}
```

### Restricciones de tipos en VOs

Los VOs solo pueden referenciar:
- Tipos canónicos (`Uuid`, `String`, `Integer`, etc.)
- Otros VOs del mismo BC
- Enums del mismo BC
- `List[<tipo_resolvible>]`

**No pueden** referenciar agregados directamente (usar `Uuid` en su lugar).

---

## 4. Sección `projections`

Una projection es un shape de lectura optimizado que no coincide 1:1 con un agregado.
Es el tipo de retorno de queries que necesitan componer datos de múltiples fuentes o
exponer un subconjunto de campos.

**Problema que resuelve:** sin projections, las queries deben devolver el agregado
completo o un tipo genérico. Las projections permiten diseñar el retorno exacto del
query sin contaminar el agregado con preocupaciones de presentación.

```yaml
projections:

  - name: ProductSummary
    description: Compact view of a product for listing pages.
    source: aggregate:Product
    properties:
      - name: id
        type: Uuid
        required: true
      - name: name
        type: String(200)
        required: true
      - name: slug
        type: Slug
        required: true
      - name: status
        type: ProductStatus
        required: true
      - name: price
        type: Money
        required: true
      - name: mainImageUrl
        type: Url
        required: false

  - name: ProductDetail
    description: Full product detail view for product pages.
    source: aggregate:Product
    properties:
      - name: id
        type: Uuid
        required: true
      - name: name
        type: String(200)
        required: true
      - name: description
        type: Text
        required: false
      - name: status
        type: ProductStatus
        required: true
      - name: price
        type: Money
        required: true
      - name: images
        type: List[ProductImageSummary]
        required: false

  - name: ProductImageSummary
    description: Compact image view nested inside ProductDetail.
    properties:
      - name: imageId
        type: Uuid
        required: true
      - name: type
        type: ImageType
        required: true
      - name: url
        type: Url
        required: true
```

### Propiedades de una projection

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | PascalCase | ✅ | Nombre de la projection. **No puede terminar** en `Dto`, `Response`, `Request` o `Payload` (el generador lo rechaza con error). |
| `description` | texto | no | Para qué sirve esta vista. |
| `source` | `aggregate:{Name}` \| `readModel:{Name}` | no | Origen conceptual de los datos. No afecta generación de código directamente. |
| `properties` | lista | ✅ (mínimo 1) | Campos de la projection. |

### Propiedades de una propiedad de projection

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | camelCase | ✅ | Nombre del campo Java. |
| `type` | tipo canónico | ✅ | Tipo del campo. |
| `required` | boolean | no | Solo documentación; no genera validaciones de bean en el DTO de lectura. |
| `description` | texto | no | Solo referencia. |
| `example` | valor | no | Ejemplo de valor. Solo documentación. |
| `serializedName` | string | no | Nombre alternativo al serializar a JSON. Genera `@JsonProperty`. |
| `derivedFrom` | string | no | Indica que este campo se deriva de otro campo. Genera comentario `// derived_from:`. |

### Restricciones de tipos en projections

Las projections pueden referenciar:
- Tipos canónicos
- Enums, VOs y otras projections del mismo BC
- `List[<tipo_resolvible>]`

**No pueden** referenciar agregados directamente.

### Código Java generado

**`ProductSummary.java`** (projection como record Java):
```java
package com.canastaShop.catalog.application.dtos;

import java.util.UUID;
import java.net.URI;
import com.canastaShop.catalog.domain.enums.ProductStatus;
import com.canastaShop.catalog.domain.valueObjects.Money;
import com.canastaShop.catalog.domain.valueObjects.Slug;

public record ProductSummary(
    UUID id,
    String name,
    Slug slug,
    ProductStatus status,
    Money price,
    URI mainImageUrl
) {}
```

**`ProductDetail.java`** (con lista anidada):
```java
public record ProductDetail(
    UUID id,
    String name,
    String description,
    ProductStatus status,
    Money price,
    List<ProductImageSummary> images
) {}
```

**`ProductImageSummary.java`:**
```java
public record ProductImageSummary(
    UUID imageId,
    ImageType type,
    URI url
) {}
```

### Projection con `serializedName`

```yaml
  - name: OrderSnapshot
    properties:
      - name: orderId
        type: Uuid
        required: true
        serializedName: order_id   # ← fuerza nombre en JSON
```

Genera:
```java
public record OrderSnapshot(
    @JsonProperty("order_id")
    UUID orderId
) {}
```

### Projection con `derivedFrom`

```yaml
  - name: InvoiceView
    properties:
      - name: totalWithTax
        type: Decimal
        precision: 19
        scale: 4
        derivedFrom: subtotal      # ← campo calculado
```

Genera:
```java
public record InvoiceView(
    // derived_from: subtotal
    BigDecimal totalWithTax
) {}
```

---

## 5. Tipos canónicos disponibles

Todos los campos de `type` en propiedades (aggregates, entities, VOs, projections) deben
usar **tipos canónicos**. Los tipos de Java (`string`, `int`, `bool`) están prohibidos y
el generador falla si los detecta.

| Tipo canónico | Java | PostgreSQL | Restricciones / Notas |
|---|---|---|---|
| `Uuid` | `UUID` | `uuid` | |
| `String` | `String` | `text` | Sin límite de longitud. |
| `String(n)` | `String` + `@Size(max=n)` | `varchar(n)` | `n` es el límite de caracteres. |
| `Text` | `String` | `text` | Para textos largos (descripciones, notas). |
| `Integer` | `Integer` | `integer` | |
| `Long` | `Long` | `bigint` | |
| `Decimal` | `BigDecimal` | `numeric(p,s)` | **Requiere** `precision` y `scale` en la propiedad. |
| `Boolean` | `Boolean` | `boolean` | |
| `Date` | `LocalDate` | `date` | Fecha sin hora. |
| `DateTime` | `Instant` | `timestamptz` | Timestamp con timezone. |
| `Duration` | `Duration` | `interval` | Duración ISO-8601. |
| `Email` | `String` + `@Email` | `varchar(254)` | |
| `Url` | `URI` | `text` | |
| `Money` | `Money` (VO embeddable) | dos columnas | Siempre referencia el VO `Money` declarado en `valueObjects`. |
| `List[T]` | `List<T>` | — | T debe ser un tipo canónico o tipo de dominio. No para columnas JPA directas; solo para parámetros y campos de proyecciones. |
| `Range[T]` | `Range<T>` | — | Solo válido en parámetros de queries con filtros de rango. T puede ser `Integer`, `Long`, `Decimal`, `Date`, `DateTime`. |
| `SearchText` | `String` | — | Solo válido en parámetros de input con `fields[]`. Activa búsqueda LIKE en los campos declarados. |
| `Enum<X>` | `X` (enum Java) | `varchar` | Referencia explícita a un enum. También se puede usar directamente el nombre PascalCase del enum. |
| `File` | `MultipartFile` | — | Solo válido en `input` con `source: multipart`. |
| `BinaryStream` | `Resource` | — | Solo válido en `returns` de un query. |

### Tipos prohibidos

Los siguientes tipos producen error inmediato en la validación:

| Prohibido | Usar en su lugar |
|---|---|
| `string` | `String` o `String(n)` |
| `int` | `Integer` |
| `number` | `Decimal` |
| `float` | `Decimal` |
| `bool` | `Boolean` |
| `date` | `Date` |
| `timestamp` | `DateTime` |
| `any`, `object` | Tipo de dominio específico |
| `bigint` | `Long` |
| `varchar(n)` | `String(n)` |

### Validaciones de propiedad

Las propiedades de agregados, entidades y VOs pueden declarar una lista `validations`
con restricciones adicionales que generan tanto anotaciones Jakarta Validation en los
DTOs como guardas imperativas en los constructores de dominio.

```yaml
properties:
  - name: sku
    type: String(50)
    required: true
    validations:
      - minLength: 3
      - pattern: "^[A-Z0-9\\-]+$"

  - name: stock
    type: Integer
    required: true
    validations:
      - min: 0
      - max: 99999

  - name: price
    type: Decimal
    precision: 19
    scale: 4
    required: true
    validations:
      - positive: true
```

#### Restricciones disponibles

| Restricción | Tipos aplicables | Anotación Jakarta | Guarda imperativa |
|---|---|---|---|
| `minLength: N` | String, Text, Email, String(n) | `@Size(min=N)` | `if (field.length() < N) throw...` |
| `maxLength: N` | String, Text, Email | `@Size(max=N)` | `if (field.length() > N) throw...` |
| `notEmpty: true` | String, Text, List[T] | `@NotEmpty` | `if (field.isEmpty()) throw...` |
| `pattern: "regex"` | String, Text, Email, String(n) | `@Pattern(regexp="...")` | `if (!field.matches(...)) throw...` |
| `min: N` | Integer, Long, Decimal | `@Min(N)` / `@DecimalMin("N")` | `if (field < N) throw...` |
| `max: N` | Integer, Long, Decimal | `@Max(N)` / `@DecimalMax("N")` | `if (field > N) throw...` |
| `positive: true` | Integer, Long, Decimal | `@Positive` | `if (field <= 0) throw...` |
| `positiveOrZero: true` | Integer, Long, Decimal | `@PositiveOrZero` | `if (field < 0) throw...` |
| `negative: true` | Integer, Long, Decimal | `@Negative` | `if (field >= 0) throw...` |
| `negativeOrZero: true` | Integer, Long, Decimal | `@NegativeOrZero` | `if (field > 0) throw...` |
| `future: true` | Date, DateTime | `@Future` | — |
| `futureOrPresent: true` | Date, DateTime | `@FutureOrPresent` | — |
| `past: true` | Date, DateTime | `@Past` | — |
| `pastOrPresent: true` | Date, DateTime | `@PastOrPresent` | — |
| `minSize: N` | List[T] | `@Size(min=N)` | `if (field.size() < N) throw...` |
| `maxSize: N` | List[T] | `@Size(max=N)` | — |

#### Ejemplo de validaciones combinadas

```yaml
- name: name
  type: String(200)
  required: true
  validations:
    - minLength: 3
    - notEmpty: true
```

Genera en el DTO:
```java
@NotNull
@Size(min = 3, max = 200)
@NotEmpty
private String name;
```

Y en el constructor del dominio:
```java
public Product(String name, ...) {
    Objects.requireNonNull(name, "name must not be null");
    if (name != null && name.length() < 3) {
        throw new IllegalArgumentException("name must be at least 3 characters long");
    }
    if (name != null && name.isEmpty()) {
        throw new IllegalArgumentException("name must not be empty");
    }
    this.name = name;
    // ...
}
```
