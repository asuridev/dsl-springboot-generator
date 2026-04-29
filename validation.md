# Validation Rules — Referencia para el Generador

Este documento define el vocabulario completo de `validations` permitido en:
- `aggregates[].properties[]`
- `aggregates[].entities[].properties[]`
- `valueObjects[].properties[]`

del `{bc-name}.yaml`.

Las constraints aquí declaradas son **agnósticas a la tecnología**. El generador
las traduce a las annotations correspondientes en cada plataforma destino.

---

## Cómo funciona la herencia de validaciones

Las `validations` se heredan automáticamente en dos niveles:

### Nivel 1 — Propiedades de agregados y entidades

Las `validations` definidas en `properties[]` de un agregado **se heredan automáticamente**
en todos los commands que incluyan ese campo en su `input[]`. El generador resuelve
el campo por nombre (`input[].name === properties[].name`) dentro del mismo agregado.

```
aggregates[Product].properties[name].validations
    → CreateProductCommand.name    ← hereda las constraints
    → UpdateProductCommand.name    ← hereda las constraints
    → [cualquier futuro command que incluya name] ← hereda las constraints
```

Si el campo es `required: false` en un `input[]` específico (update parcial), las
constraints siguen aplicando **si el valor está presente** en el request.

### Nivel 2 — Propiedades de Value Objects

Las `validations` definidas en `valueObjects[].properties[]` **se propagan automáticamente**
a toda propiedad de un agregado o entidad cuyo `type` sea ese VO. El generador aplica
las constraints del VO al generar los commands que incluyen ese campo.

```
valueObjects[Money].properties[amount].validations: [positive: true]
    → aggregates[Product].properties[price] (type: Money)
        → CreateProductCommand.priceAmount    ← hereda positive: true
        → UpdateProductPriceCommand.priceAmount ← hereda positive: true

valueObjects[Money].properties[currency].validations: [pattern: "^[A-Z]{3}$"]
    → CreateProductCommand.priceCurrency  ← hereda el pattern
```

Esto garantiza que las restricciones de un VO se apliquen de forma consistente
en cualquier agregado que lo utilice, sin duplicar la declaración.

---

## Vocabulario de constraints

### Strings — `String`, `String(n)`, `Text`, `Email`

| Constraint | Valor | Descripción |
|---|---|---|
| `minLength` | entero ≥ 1 | Longitud mínima en caracteres |
| `pattern` | string regex | El valor debe coincidir con la expresión regular |
| `notEmpty` | `true` | No vacío (puede tener espacios, a diferencia de `required`) |

**Notas:**
- `maxLength` **no se usa** — ya está implícito en `String(n)`.
- `notBlank` **no se usa** — ya está implícito en `required: true` sobre un String.
- `pattern` debe usar sintaxis ECMA-262 / Java (los dos son compatibles para patrones básicos).
- En `Email` y `Url` no tiene sentido agregar `pattern` — el tipo ya valida el formato.

**Ejemplos:**
```yaml
- name: sku
  type: String(100)
  required: true
  validations:
    - minLength: 3
    - pattern: "^[A-Z0-9\\-]+$"

- name: phoneNumber
  type: String(20)
  required: false
  validations:
    - pattern: "^\\+?[1-9]\\d{6,14}$"

- name: currency
  type: String(3)
  required: true
  validations:
    - pattern: "^[A-Z]{3}$"        # ISO 4217
```

---

### Números — `Integer`, `Long`, `Decimal`

| Constraint | Valor | Descripción |
|---|---|---|
| `min` | número | Valor mínimo **inclusive** |
| `max` | número | Valor máximo **inclusive** |
| `positive` | `true` | Estrictamente mayor que cero (excluye 0) |
| `positiveOrZero` | `true` | Mayor o igual a cero (incluye 0) |
| `negative` | `true` | Estrictamente menor que cero |
| `negativeOrZero` | `true` | Menor o igual a cero |

**Notas:**
- `min` y `max` son mutuamente componibles con `positive`/`positiveOrZero`.
- Para `Decimal`, `min` y `max` se expresan como string numérico (`"0.01"`) para preservar precisión.
- `precision` y `scale` en `Decimal` **no son validations** — son atributos del tipo; se declaran directamente en la propiedad.

**Ejemplos:**
```yaml
- name: sortOrder
  type: Integer
  required: true
  validations:
    - positiveOrZero: true
    - max: 999

- name: discount
  type: Decimal
  precision: 5
  scale: 2
  required: false
  validations:
    - min: "0.00"
    - max: "100.00"

- name: quantity
  type: Integer
  required: true
  validations:
    - positive: true
    - max: 9999
```

---

### Temporales — `Date`, `DateTime`

| Constraint | Valor | Descripción |
|---|---|---|
| `future` | `true` | Debe ser una fecha/hora estrictamente futura |
| `futureOrPresent` | `true` | Debe ser una fecha/hora futura o igual al momento actual |
| `past` | `true` | Debe ser una fecha/hora estrictamente pasada |
| `pastOrPresent` | `true` | Debe ser una fecha/hora pasada o igual al momento actual |

**Ejemplos:**
```yaml
- name: expiresAt
  type: DateTime
  required: false
  validations:
    - future: true

- name: birthDate
  type: Date
  required: true
  validations:
    - past: true

- name: scheduledFor
  type: DateTime
  required: true
  validations:
    - futureOrPresent: true
```

---

### Colecciones — `List[T]`

| Constraint | Valor | Descripción |
|---|---|---|
| `minSize` | entero ≥ 0 | Mínimo N elementos en la lista |
| `maxSize` | entero ≥ 1 | Máximo N elementos en la lista |

**Ejemplos:**
```yaml
- name: tags
  type: List[String]
  required: false
  validations:
    - maxSize: 10

- name: recipients
  type: List[Email]
  required: true
  validations:
    - minSize: 1
    - maxSize: 50
```

---

## Constraints implícitas por tipo — NO declarar en `validations`

El generador aplica estas constraints automáticamente según el tipo canónico.
Declararlas en `validations` es un error de diseño (redundancia).

| Tipo | Constraint implícita | Traducción Java | Traducción TS |
|---|---|---|---|
| `String(n)` | `maxLength: n` | `@Size(max=n)` | `@MaxLength(n)` |
| `Email` | formato email válido | `@Email` | `@IsEmail()` |
| `Url` | formato URL absoluta | `@URL` | `@IsUrl()` |
| `Uuid` | formato UUID v4 | anotación en deserialización | `@IsUUID('4')` |
| `required: true` en String/Text/Email/Url | no nulo y no vacío | `@NotBlank` | `@IsNotEmpty()` |
| `required: true` en otros tipos | no nulo | `@NotNull` | `@IsDefined()` |
| `Decimal` con `precision`/`scale` | dígitos exactos | `@Digits(integer=p-s, fraction=s)` | — |

---

## Traducción por plataforma

### Java (Spring Boot + Jakarta Validation)

| Constraint DSL | Annotation Java |
|---|---|
| `minLength: N` | `@Size(min = N)` |
| `pattern: "REGEXP"` | `@Pattern(regexp = "REGEXP")` |
| `notEmpty: true` | `@NotEmpty` |
| `min: N` | `@Min(N)` (Integer/Long) / `@DecimalMin("N")` (Decimal) |
| `max: N` | `@Max(N)` (Integer/Long) / `@DecimalMax("N")` (Decimal) |
| `positive: true` | `@Positive` |
| `positiveOrZero: true` | `@PositiveOrZero` |
| `negative: true` | `@Negative` |
| `negativeOrZero: true` | `@NegativeOrZero` |
| `future: true` | `@Future` |
| `futureOrPresent: true` | `@FutureOrPresent` |
| `past: true` | `@Past` |
| `pastOrPresent: true` | `@PastOrPresent` |
| `minSize: N` | `@Size(min = N)` |
| `maxSize: N` | `@Size(max = N)` |
| `minLength: N` + `String(n)` | `@Size(min = N, max = n)` (combinadas en una sola annotation) |

**Ejemplo generado:**
```java
public record CreateProductCommand(
    @NotBlank @Size(min = 3, max = 200) String name,
    String description,
    @NotBlank @Pattern(regexp = "^[A-Z0-9\\-]+$") @Size(min = 3, max = 100) String sku,
    @NotNull @Positive BigDecimal priceAmount,
    @NotBlank @Pattern(regexp = "^[A-Z]{3}$") String priceCurrency,
    @NotBlank String categoryId
) implements Command {}
```

### TypeScript (class-validator)

| Constraint DSL | Decorator TypeScript |
|---|---|
| `minLength: N` | `@MinLength(N)` |
| `pattern: "REGEXP"` | `@Matches(/REGEXP/)` |
| `notEmpty: true` | `@IsNotEmpty()` |
| `min: N` | `@Min(N)` |
| `max: N` | `@Max(N)` |
| `positive: true` | `@IsPositive()` |
| `positiveOrZero: true` | `@Min(0)` |
| `negative: true` | `@IsNegative()` |
| `negativeOrZero: true` | `@Max(0)` |
| `future: true` | `@MinDate(new Date())` |
| `past: true` | `@MaxDate(new Date())` |
| `minSize: N` | `@ArrayMinSize(N)` |
| `maxSize: N` | `@ArrayMaxSize(N)` |

---

## Reglas de validación del diseñador (qué DEBE hacer el agente)

1. **Siempre declarar `validations` cuando el dominio lo exige.** Si una propiedad tiene
   restricciones de negocio que el tipo solo no captura (mínimos, patrones, rangos),
   deben aparecer en `validations`. Omitirlas es un diseño incompleto.

2. **Nunca repetir lo implícito del tipo.** `String(200)` ya garantiza `maxLength: 200`.
   Añadir `maxLength: 200` en `validations` es ruido.

3. **Usar el constraint más semántico disponible.** Preferir `positive: true` sobre
   `min: 1` cuando el significado es "precio positivo" — es más expresivo para el lector
   y para el generador.

4. **`pattern` debe ser siempre una expresión válida** en ECMA-262. Escapar `\` como `\\`
   dentro del string YAML.

5. **Los constraints de `Decimal` con `min`/`max` usan string** para evitar pérdida de
   precisión en parsers YAML: `min: "0.01"`, no `min: 0.01`.

6. **`validations` solo en `properties[]`** — tanto en `aggregates[].properties[]`,
   `aggregates[].entities[].properties[]` como en `valueObjects[].properties[]`.
   No declarar en `input[]` de use cases ni en `domainMethods[].params[]`.
   La fuente de verdad son el agregado y los VOs; el generador propaga.

---

## Ejemplo completo aplicado

```yaml
valueObjects:
  - name: Money
    description: >
      Represents an exact monetary amount with its currency.
    properties:
      - name: amount
        type: Decimal
        precision: 19
        scale: 4
        required: true
        description: Exact monetary amount.
        validations:
          - positive: true          # un monto monetario nunca es negativo ni cero
      - name: currency
        type: String(3)
        required: true
        description: ISO 4217 currency code.
        validations:
          - pattern: "^[A-Z]{3}$"  # exactamente 3 letras mayúsculas

aggregates:
  - name: Product
    properties:
      - name: name
        type: String(200)
        required: true
        validations:
          - minLength: 3

      - name: sku
        type: String(100)
        required: true
        unique: true
        validations:
          - minLength: 3
          - pattern: "^[A-Z0-9\\-]+$"

      - name: price
        type: Money          # hereda positive + pattern desde valueObjects[Money]
        required: true

      - name: description
        type: Text
        required: false
        # sin validations — Text sin restricciones adicionales

    entities:
      - name: ProductImage
        properties:
          - name: sortOrder
            type: Integer
            required: true
            validations:
              - positiveOrZero: true
              - max: 999

  - name: Category
    properties:
      - name: name
        type: String(200)
        required: true
        unique: true
        validations:
          - minLength: 2
```
