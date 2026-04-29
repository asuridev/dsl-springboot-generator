# Nuevas características soportadas en archivos de diseño — Proyecciones

Este documento describe las extensiones del schema YAML de Bounded Context introducidas por las fases 1–7 del plan de mejoras de `projections`. Todas las extensiones son **opcionales** y **retrocompatibles**: catálogos existentes siguen funcionando sin modificaciones.

---

## 1. Validaciones nuevas (estrictas)

Estas validaciones aplican a `projections[]` en `{bc}.yaml`. Un diseño que las viole **fallará** al regenerar con un mensaje preciso del validador.

### 1.1. Naming reservado prohibido (G9)

El nombre de una proyección NO puede terminar en `Dto`, `Response`, `Request` o `Payload`. Estos sufijos están reservados para DTOs de transporte (controllers, OpenAPI). Una proyección representa una vista de lectura del dominio, no un DTO.

```yaml
# ❌ Inválido
projections:
  - name: ProductDto

# ✅ Válido
projections:
  - name: ProductSummary
```

### 1.2. Lista blanca de atributos por propiedad (G12)

Cada propiedad de una proyección sólo puede declarar las siguientes claves:

| Clave | Requerida | Descripción |
|---|---|---|
| `name` | ✅ | Nombre del campo (camelCase). |
| `type` | ✅ | Tipo canónico, enum, VO o proyección anidada. |
| `required` | ❌ | `false` activa `@JsonInclude(NON_NULL)` a nivel de clase. |
| `description` | ❌ | Genera Javadoc + `@Schema(description=...)` (opt-in). |
| `example` | ❌ | Genera `@Schema(example=...)` (opt-in). |
| `serializedName` | ❌ | Distinto al `name` → `@JsonProperty("…")`. |
| `derivedFrom` | ❌ | Comentario `derived_from:` para trazabilidad. |

Cualquier otra clave aborta la generación.

### 1.3. Proyección vacía prohibida (G13)

Una proyección debe declarar al menos una propiedad bajo `properties:`. Omitir `properties` o usar una lista vacía aborta la generación.

---

## 2. `returns:` inline en casos de uso (G4)

Los casos de uso de tipo `query` ahora aceptan `returns:` como lista de propiedades. El generador sintetiza una proyección llamada `${PascalCase(uc.name)}Result` y la inyecta en `projections[]`.

### Antes (todavía soportado)
```yaml
projections:
  - name: ValidateProductAndSnapPriceResult
    properties:
      - { name: productId, type: Uuid }
      - { name: price, type: Money }

useCases:
  - id: UC-INT-001
    name: ValidateProductAndSnapPrice
    returns: ValidateProductAndSnapPriceResult
```

### Ahora (forma compacta)
```yaml
useCases:
  - id: UC-INT-001
    name: ValidateProductAndSnapPrice
    returns:
      - { name: productId, type: Uuid }
      - { name: price, type: Money }
```

El generador produce automáticamente el record `ValidateProductAndSnapPriceResult.java`. Si ya existe una proyección con ese nombre en `projections[]`, el build aborta con error de colisión.

---

## 3. Trazabilidad y anotaciones por propiedad (G6, G7, G16)

### 3.1. `description` en la proyección
Genera Javadoc encima del record:

```yaml
projections:
  - name: ProductPriceSnapshot
    description: >
      Read-only view of a product's current price, returned by the internal
      API when the orders BC validates and snapshots the price at checkout.
```

→
```java
/**
 * Read-only view of a product's current price, returned by the internal API
 * when the orders BC validates and snapshots the price at checkout.
 */
// derived_from: projection:ProductPriceSnapshot
// used_by: useCase:UC-INT-001
public record ProductPriceSnapshot(UUID productId, Money price) {}
```

El comentario `used_by:` se computa automáticamente a partir de los UCs cuyo `returns` referencia la proyección.

### 3.2. `serializedName` por propiedad
Cuando difiere del `name`, emite `@JsonProperty`:

```yaml
properties:
  - name: unitPrice
    type: Money
    serializedName: "unit_price"
```

→ `@JsonProperty("unit_price") Money unitPrice`

### 3.3. `description` y `example` por propiedad (opt-in)

Activos sólo cuando el `dsl-springboot.json` declara `openApiAnnotations: true`:

```yaml
properties:
  - name: price
    type: Money
    description: "Authoritative product price at query time."
    example: "12.50"
```

→ `@Schema(description = "...", example = "12.50") Money price`

### 3.4. `required: false`
Cuando alguna propiedad es opcional, la clase recibe `@JsonInclude(JsonInclude.Include.NON_NULL)` a nivel de record.

### 3.5. `derivedFrom` por propiedad
Texto libre que se preserva como metadato (uso futuro: comentarios `// derived_from:` por campo).

---

## 4. `projections[].source` — vínculo explícito a un agregado (G15)

Permite forzar al generador a producir el método `to{Projection}` en el `ApplicationMapper` de un agregado específico, en lugar de aplicar el heurístico (cualquier UC del agregado que retorne la proyección).

```yaml
projections:
  - name: LocalProductView
    source: aggregate:Product
    properties:
      - { name: id, type: Uuid }
      - { name: status, type: Enum<ProductStatus> }
```

Formatos aceptados:
- `aggregate:<Name>` — vincula la proyección al agregado `<Name>`.
- `readModel:<Name>` — reservado para futura integración con read-models locales.

Cualquier otro valor aborta la generación.

---

## 5. Tipos canónicos adicionales en proyecciones y DTOs (G14 parcial)

`javaTypeForDto` reconoce ahora estos tipos del DSL además de los previamente soportados:

| DSL type | Java |
|---|---|
| `Date` | `java.time.LocalDate` |
| `Duration` | `java.time.Duration` |
| `BigInt` / `BigInteger` | `java.math.BigInteger` |
| `Json` / `JSON` | `com.fasterxml.jackson.databind.JsonNode` |

Ejemplo:
```yaml
projections:
  - name: SubscriptionWindow
    properties:
      - { name: startsOn, type: Date }
      - { name: ttl,      type: Duration }
      - { name: counter,  type: BigInt }
      - { name: payload,  type: Json }
```

---

## 6. Formatos OpenAPI reconocidos en `internal-api.yaml` (G1)

Cuando un `internal-api.yaml` declara propiedades con `format`, el generador deja de mapearlas a `String`:

| OpenAPI | Java |
|---|---|
| `string` + `format: uuid` | `java.util.UUID` |
| `string` + `format: date-time` | `java.time.Instant` |
| `string` + `format: date` | `java.time.LocalDate` |
| `string` + `format: decimal` | `java.math.BigDecimal` |
| `integer` + `format: int64` | `long` |

Si un `$ref` apunta a un schema cuyo nombre coincide con un VO, enum o proyección del BC, el generador reusa el tipo de dominio en lugar de generar un `${name}Dto` paralelo.

---

## 7. Coherencia público/proyección (G10, G11)

- En la rama `uc.type === 'query'` del Public OpenAPI, el filtro `schemasToGenerate` ahora excluye nombres que coincidan con proyecciones del BC. La proyección se genera **una sola vez** desde `projections[]` (record con record-syntax + Javadoc) y se importa en el controller con su nombre crudo (sin sufijo `Dto`).
- Los controllers ya importan `application.dtos.<ProjectionName>` y exponen `PagedResponse<<ProjectionName>>` cuando el `returns` declara `Page[<ProjectionName>]`.

---

## 8. Validación referencial estricta (G8)

Cada propiedad de una proyección debe resolverse a uno de los siguientes:
- Tipo canónico del DSL (`Uuid`, `String`, `Decimal`, `Date`, `DateTime`, …).
- Enum declarado en `enums[]` (directamente o como `Enum<X>`).
- Value Object declarado en `valueObjects[]`.
- Otra proyección declarada en `projections[]`.
- `List[<resolvable>]`.

Referencias a agregados están **prohibidas**: una proyección no puede embeber un agregado. Use el id del agregado (`Uuid`) o componga otra proyección.

```yaml
# ❌ Inválido
projections:
  - name: BadProjection
    properties:
      - { name: product, type: Product }   # Product es agregado

# ✅ Válido
projections:
  - name: GoodProjection
    properties:
      - { name: productId, type: Uuid }
```

---

## 9. Mapper automático y handler de query rellenado (G2, G5)

Si una proyección es **derivable** (todas sus propiedades existen como propiedades públicas del agregado raíz, ignorando `hidden`/`internal`, considerando audit fields cuando `auditable: true`), el generador produce:

1. Método `to{Projection}(Aggregate domain)` en `${Aggregate}ApplicationMapper.java` con cuerpo real.
2. Si la proyección se usa en un retorno tipo `List[X]` o `Page[X]`, también `to{Projection}List(...)`.
3. Cuerpo del `QueryHandler.execute()` que usa `mapper::to{Projection}` en single, list y paged paths.

Si NO es derivable (alguna propiedad no coincide con el agregado), el método `to{Projection}` se genera con un `// TODO` y `throw new UnsupportedOperationException(...)` para que la Fase 3 (implementación humana) lo complete con el mapeo correcto.

---

## 10. Resumen rápido — claves nuevas en `{bc}.yaml`

```yaml
projections:
  - name: ProductSummary                  # G9: no termina en Dto/Response/Request/Payload
    description: "Read-only product view" # G6: Javadoc + @Schema
    source: aggregate:Product             # G15: override del heurístico de mapper
    properties:
      - name: id
        type: Uuid                        # G14: incluye Date, Duration, BigInt, Json
        required: true
        description: "Product identifier" # G7: opt-in con openApiAnnotations
        example: "abc-123"                # G7
        serializedName: "product_id"      # G7: @JsonProperty
        derivedFrom: "aggregate:Product#id" # G16: trazabilidad

useCases:
  - id: UC-XXX
    name: GetProductSummary
    type: query
    aggregate: Product
    returns:                              # G4: lista inline → proyección sintética
      - { name: id, type: Uuid }
      - { name: name, type: String }
```

---

## 11. Lo que NO cambió

- La estructura de `aggregates[]`, `entities[]`, `valueObjects[]`, `enums[]`, `errors[]`, `useCases[]`, `repositories[]` permanece intacta.
- Los catálogos existentes (`arch/{bc-name}/{bc-name}.yaml`) compilan sin cambios.
- El schema de `system.yaml` no fue modificado.
- Los artefactos en `arch/review/` siguen siendo ignorados por el generador.
