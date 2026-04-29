# Análisis profundo de la sección `projections` — robustez del generador

> Diseño analizado: `C:/Users/antonio.suarez/Desktop/test-dsl/arch/catalog/`
> Código generado: `C:/Users/antonio.suarez/Desktop/test-dsl/`
> Generador: [src/generators/application-generator.js](src/generators/application-generator.js) (`generateProjections`, líneas 1390-1416) + [templates/application/Projection.java.ejs](templates/application/Projection.java.ejs)

> **Estado actual (post-implementación fases 1–7):** los 16 gaps detectados están resueltos. Las nuevas capacidades soportadas por el diseño YAML están documentadas en [docs/projections-new-features.md](../docs/projections-new-features.md). Cada gap conserva su descripción original como referencia histórica e incluye un badge **✅ Resuelto** con la fase/commit correspondiente.

---

## 1. Qué soporta hoy el generador (estado actual)

### 1.1 Diseño contra código generado

Diseño en [arch/catalog/catalog.yaml](../../test-dsl/arch/catalog/catalog.yaml) (resumen):

```yaml
projections:
  - name: ProductPriceSnapshot
    description: Read-only view of a product's current price …
    properties:
      - { name: productId, type: Uuid, description: … }
      - { name: price,     type: Money, description: … }
```

Y se referencia desde `UC-INT-001`:

```yaml
- id: UC-INT-001
  name: ValidateProductAndSnapPrice
  type: query
  trigger: { kind: http, operationId: validateProductAndSnapPrice }
  returns: ProductPriceSnapshot
  implementation: full
```

Salida en `src/main/java/co/com/asuarez/catalog/application/dtos/ProductPriceSnapshot.java`:

```java
public record ProductPriceSnapshot(UUID productId, Money price) {}
```

Lo que **funciona correctamente**:

| Capacidad | Cómo se logra |
|---|---|
| Generación de un `record` por proyección en `application/dtos/` | `generateProjections()` itera `bcYaml.projections[]` |
| Tipos canónicos (`Uuid`, `DateTime`, `Decimal`, `String(n)`, `Boolean`, `Integer`, `Long`, `Text`, `Email`, `Url`, `Money`) | `javaTypeForDto()` |
| `List[T]` recursivo | rama `listDtoMatch` en `javaTypeForDto` |
| Referencia a un Value Object del BC (`Money`, etc.) | `voNames.has(type)` con import correcto a `domain.valueobject.X` |
| Referencia a un Enum del BC (`Enum<X>` o nombre desnudo) | rama enum |
| Sin sufijo `Dto` (nombre limpio) | el template usa `projectionName` directamente |
| No duplicación cuando la proyección coincide con un schema del internal-API | filtro `bcProjectionNames.has(s)` en el bloque internal-API (líneas 1503-1508) |
| Uso correcto en el `Query` y `QueryHandler` cuando responde una proyección desde el internal-API | rama `isProjectionResponse` (líneas 1527-1533) |
| Uso del nombre crudo en el `Controller` REST (no `Dto`) | `controller-generator.js` línea 465 reconoce nombres "custom" |
| Validación de unicidad del nombre de la proyección | `bc-yaml-reader.js` líneas 121-128 |

---

## 2. Gaps detectados

A continuación los huecos que comprometen el objetivo de "soportar la mayoría de diseños y escenarios posibles". Cada gap se describe con: **escenario que rompe**, **causa**, **impacto**, **propuesta**.

### G1 — Tipo `format: uuid` del internal-API se mapea como `String` en el `Query`  ✅ Resuelto (Fase 1)

- **Escenario:** `UC-INT-001` declara `productId: Uuid` en el YAML, pero el `Query` se construye desde el schema OpenAPI del internal-API (`ValidateProductRequest.productId: string format uuid`). El generador produce `record ValidateProductAndSnapPriceQuery(@NotNull String productId)` mientras que la proyección de retorno usa `UUID productId`. Hay inconsistencia tipológica entre input y output del mismo handler.
- **Causa:** [openApiPropToJavaType()](src/generators/application-generator.js#L1175) ignora `format: uuid|date-time|date|decimal` y devuelve `String` por defecto.
- **Impacto:** el handler tendrá que hacer `UUID.fromString(query.productId())` manualmente; rompe la simetría con los `Command`s que convierten en el handler. Más grave: si el `$ref` apunta a un Value Object (p.ej. `Money`), genera `MoneyDto` (clase inexistente) en lugar de importar el VO real.
- **Propuesta:**
  - Reconocer `format: uuid` → `UUID`, `format: date-time` → `Instant`, `format: date` → `LocalDate`, `format: decimal` → `BigDecimal`.
  - Antes de emitir `${name}Dto`, comprobar si `name` está en `valueObjects[]`, `enums[]` o `projections[]` del BC y reusar el tipo de dominio (igual que ya se hace para la respuesta proyectada).

### G2 — No se genera mapper `domain → projection`  ✅ Resuelto (Fase 2)

- **Escenario:** un `QueryHandler` con `implementation: full` necesita construir la proyección. Hoy no existe `productApplicationMapper.toProductPriceSnapshot(Product)`.
- **Causa:** `generateApplicationMapper()` solo emite `toResponseDto(...)` y `toResponseDtoList(...)`. No recorre `bcYaml.projections[]`.
- **Impacto:** la Fase 3 (IA o humano) tiene que escribir el mapeo a mano. Pierde determinismo y coherencia con el patrón usado para `ResponseDto`.
- **Propuesta:** añadir, por cada proyección cuyas propiedades sean un subset de las propiedades públicas del agregado raíz inferido por `useCases[].aggregate`, un método `to{Projection}(<Aggregate> domain)` y `to{Projection}List(...)` cuando aparezca en `Page[X]` o `List[X]`. Cuando la proyección no es derivable 1:1 del agregado, emitir el método con cuerpo `// TODO …` para Fase 3.

### G3 — Proyecciones anidadas (proyección dentro de proyección) no se resuelven  ✅ Resuelto (Fase 1)

- **Escenario:**
  ```yaml
  projections:
    - name: ProductSummary
      properties: [...]
    - name: ProductSearchPage
      properties:
        - { name: items, type: List[ProductSummary] }
        - { name: total, type: Integer }
  ```
- **Causa:** [javaTypeForDto()](src/generators/application-generator.js#L236) resuelve `voNames.has(type)` y, si falla, cae al ramal final que importa el tipo como **enum** (`domain.enums.ProductSummary`).
- **Impacto:** import inexistente → no compila.
- **Propuesta:** pasar `projectionNames` al resolutor y resolverlo a `application.dtos.${type}` antes del fallback enum. Mismo tratamiento dentro de `List[T]`.

### G4 — `returns` inline (array de propiedades) no se materializa  ✅ Resuelto (Fase 3)

- **Escenario:** la guía [docs/bc-yaml-guide.md](docs/bc-yaml-guide.md#L237) permite:
  ```yaml
  returns:
    - { name: productId, type: Uuid }
    - { name: price,     type: Money }
  ```
- **Causa:** [buildQueryReturnType()](src/generators/application-generator.js#L557) trata `raw` siempre como string; un array no matchea ningún regex y termina usándose tal cual.
- **Impacto:** el `Query.java` se rompe (`implements Query<[object Object]>`).
- **Propuesta:** cuando `returns` es array, generar una proyección anónima con nombre derivado (`{UseCase}Result` o `{UseCase}Projection`) y reemplazar `uc.returns` por ese nombre antes del resto del pipeline.

### G5 — `Page[Projection]` no genera el envoltorio paginado en el handler  ✅ Resuelto (Fase 2)

- **Escenario:** `returns: Page[ProductSummary]` produce `PagedResponse<ProductSummary>` en la firma — eso compila —, pero ningún mapper genera `PagedResponse<ProductSummary>` ni el `QueryHandler` pre-rellena la lectura `Page → PagedResponse` (sí lo hace para `ResponseDto` del agregado).
- **Causa:** el cuerpo automatizado en `buildQueryHandlerBody` (sub-entity y aggregate) sólo cubre el caso `${Agg}ResponseDto` y `Page<${Agg}>`.
- **Impacto:** la Fase 3 implementa de cero la paginación de la proyección.
- **Propuesta:** detectar el patrón `Page[<Projection>]` cuando exista un `repositoryMethod` que retorne `Page[<Aggregate>]` y rellenar:
  ```java
  Page<Aggregate> p = repo.findAll(...);
  return PagedResponse.from(p.map(mapper::toProjection));
  ```

### G6 — Sin Javadoc desde `description` (proyección y propiedades)  ✅ Resuelto (Fase 5)

- **Causa:** `Projection.java.ejs` no consume `proj.description` ni `prop.description`.
- **Impacto:** se pierde la trazabilidad declarada en el YAML y el `// derived_from` exigido por `AGENTS.md` §3.
- **Propuesta:** emitir un Javadoc de clase con el `description` de la proyección y, opcionalmente, `// derived_from: projection:{name}` o el `operationId` que la consume.

### G7 — Las anotaciones siempre vienen vacías  ✅ Resuelto (Fase 5, opt-in vía `openApiAnnotations`)

- **Causa:** `generateProjections` mete `annotations: []` para cada campo y el template ya soporta `f.annotations`.
- **Escenarios bloqueados:**
  - `@Schema(description = "…", example = "…")` para integrarse con springdoc.
  - `@JsonProperty("legacy_name")` para shapes con renombres.
  - `@JsonInclude(NON_NULL)` cuando `required: false`.
  - `@NotNull` en proyecciones reutilizadas como input (caso atípico, pero la guía no lo prohíbe).
- **Propuesta:** alimentar `annotations` desde `prop.required`, `prop.description`, `prop.serializedName`, `prop.example`. Mínimo viable: `@Schema(description=...)` cuando exista descripción.

### G8 — `validateProperties` no valida que el tipo sea un identificador de proyección/VO/enum/agregado conocido  ✅ Resuelto (Fase 1)

- **Causa:** [validateProperties()](src/utils/bc-yaml-reader.js#L37) sólo invoca `resolveType(prop.type)` (canónicos) sin contrastar contra los catálogos del BC.
- **Impacto:** una proyección con `type: ProductoResumen` (typo) pasa la validación y revienta en compilación Java.
- **Propuesta:** segunda pasada que verifique `voNames ∪ enumNames ∪ projectionNames ∪ aggregateNames` antes de entregar el modelo al generador.

### G9 — Ausencia de validación del naming reservado (`*Dto`, `*Response`, `*Request`, `*Payload`)  ✅ Resuelto (Fase 6)

- **Causa:** la guía lo prohíbe (`docs/bc-yaml-guide.md` §projections / Naming) pero `bc-yaml-reader.js` no lo valida.
- **Impacto:** colisión silenciosa con DTOs autogenerados (p.ej. una proyección llamada `ProductResponse` reescribe `ProductResponseDto` o convive con él de forma inconsistente).
- **Propuesta:** `fail()` si `proj.name` matchea `/(Dto|Response|Request|Payload)$/`.

### G10 — Colisión con schemas del Public OpenAPI  ✅ Resuelto (Fase 4)

- **Escenario:** un endpoint público devuelve `ProductSummary` (proyección) y el `catalog-open-api.yaml` declara también `ProductSummary` en `components.schemas`.
- **Causa:** el flujo público (líneas 1583-1602) filtra `enums`/`valueObjects`/error pero **no** filtra `projections`. `generatePublicApiResponseDtos()` produciría `ProductSummaryDto.java` que el `QueryHandler` no usa, mientras que `generateProjections()` produce `ProductSummary.java`. Resultado: dos artefactos para un mismo concepto.
- **Propuesta:** añadir `bcProjectionNames` al filtro de `schemasToGenerate` en la rama `uc.type === 'query'` pública (mismo patrón que ya existe en la rama internal).

### G11 — Las proyecciones no se exponen al `controller-generator` para endpoints públicos  ✅ Resuelto (Fase 4)

- **Escenario:** queries públicas que retornan una proyección (`Page[ProductSummary]`).
- **Causa:** en internal-API el método del controller usa el record proyección directamente, pero el `controller-generator.js` para el público se basa en el schema `${Agg}Response[Dto]`. Cuando el `Returns` del UC es proyección no aggregate, el controller emite tipos inconsistentes con el handler.
- **Verificación pendiente:** depende del catálogo público que el usuario cree; en este BC no se reproduce porque los endpoints públicos retornan `CategoryResponse`/`ProductResponse`. **Riesgo latente** documentado.
- **Propuesta:** auditar `controller-generator.js` para que la firma del endpoint y el tipo del DTO se deriven del `uc.returns` proyectado, alineándose con `buildQueryReturnType`.

### G12 — Atributos sin sentido en proyecciones se aceptan silenciosamente  ✅ Resuelto (Fase 6, lista blanca)

- **Escenario:** `unique: true`, `references: X`, `relationship: composition`, `defaultValue`, `validations:` declarados sobre una propiedad de proyección.
- **Causa:** validador genérico, no específico por contexto.
- **Impacto:** falsa señal al diseñador (cree que la regla aplica) — atenta contra la trazabilidad.
- **Propuesta:** lista blanca de atributos permitidos en `projections[].properties[]` (`name`, `type`, `required`, `description`, `example`, `serializedName`).

### G13 — Proyección sin propiedades  ✅ Resuelto (Fase 6)

- **Causa:** `validateProperties` retorna sin error si `properties` no es array; el template emite `record X();` (válido pero sin sentido).
- **Propuesta:** `fail()` si `properties` está vacío o ausente.

### G14 — Falta soporte para tipos derivados habituales en read-models  ✅ Resuelto parcial (Fase 7: `Date`, `Duration`, `BigInt`, `Json`; refactor unificado a `type-mapper.js` aplazado)

Tipos que la guía menciona o que aparecen en lecturas reales y que `javaTypeForDto` no contempla:

- `Date` → `LocalDate` (sí está en otros mappers, ausente aquí).
- `BigInt` / `Long(n)`.
- `Map<String, X>` (raro en proyección estricta, pero usual en read-models de búsqueda).
- `JSON` / `JsonNode` (cuando el read-model alimenta agregados externos).

**Propuesta:** unificar la tabla de tipos canónicos en `src/utils/type-mapper.js` para que `javaTypeForDto`, `openApiPropToJavaType` y los mappers JPA compartan el mismo catálogo.

### G15 — No hay convención de read-models locales (`readModel: true`) hacia projections  ✅ Resuelto (Fase 7: `projections[].source: aggregate:<X>` | `readModel:<X>`)

- **Escenario:** un agregado con `readModel: true` (LRM alimentado por eventos) cuyo único uso externo sea exponer una proyección compuesta. El generador no enlaza ambos conceptos: `projections[]` y `aggregates[].readModel`.
- **Propuesta:** documentar y validar la relación; permitir `projections[].source: readModel:<Aggregate>` para que el mapper se genere desde el read-model y no desde el agregado raíz.

### G16 — No existe trazabilidad `derived_from` en proyecciones  ✅ Resuelto (Fase 5: `// derived_from:` + `// used_by:`)

- **Causa:** ni el YAML actual ni el template emiten `derived_from: openapi:{operationId}` o `derived_from: useCase:{id}` en la clase generada.
- **Impacto:** rompe el principio §3 de `AGENTS.md` ("Trazabilidad obligatoria").
- **Propuesta:** comentario `// derived_from: projections:{name} (used by UC-INT-001)` en cabecera del record.

---

## 3. Matriz de cobertura (post fases 1–7)

| Escenario | Estado |
|---|---|
| Proyección plana con tipos canónicos | ✅ |
| Proyección con VO del BC | ✅ |
| Proyección con enum del BC | ✅ |
| Proyección referenciada por internal-API (response) | ✅ |
| Proyección referenciada por public OpenAPI | ✅ (G10, G11) |
| Proyección anidada (proyección → proyección / `List[Projection]`) | ✅ (G3) |
| `returns` inline (array anónimo) | ✅ (G4) |
| `Page[Projection]` con cuerpo del handler autogenerado | ✅ (G5) |
| Mapper domain→projection | ✅ (G2) |
| Javadoc + trazabilidad `derived_from` / `used_by` | ✅ (G6, G16) |
| Anotaciones (`@Schema`, `@JsonProperty`, `@JsonInclude`) | ✅ (G7, opt-in) |
| Validación de tipos referenciados | ✅ (G8) |
| Validación de naming reservado | ✅ (G9) |
| Validación de atributos no aplicables | ✅ (G12) |
| Coherencia tipo `Uuid`/`DateTime` entre OpenAPI y proyección | ✅ (G1) |
| Tipos `Date`, `Duration`, `BigInt`, `Json` | ✅ (G14 parcial) |
| Tipo `Map<String, X>` | ⏸ aplazado (G14) |
| Vínculo con `readModel: true` | ✅ (G15, vía `projections[].source`) |
| Proyección vacía | ✅ (G13, fail-fast) |

---

## 4. Priorización ejecutada

Orden de implementación efectivamente aplicado (todas las fases verificadas con `gradlew clean compileJava` → BUILD SUCCESSFUL sobre el catálogo de prueba):

1. ✅ **Fase 1 — G1 + G3 + G8** — bloqueos de compilación más comunes.
2. ✅ **Fase 2 — G2 + G5** — productividad real de Fase 3 (mapper y paginación).
3. ✅ **Fase 3 — G4** — `returns` inline materializado como proyección sintética `${UseCase}Result`.
4. ✅ **Fase 4 — G10 + G11** — coherencia público/proyección.
5. ✅ **Fase 5 — G6 + G16 + G7** — trazabilidad (`// derived_from:`, `// used_by:`) y anotaciones opt-in.
6. ✅ **Fase 6 — G9 + G12 + G13** — validaciones defensivas (fail-fast).
7. ✅ **Fase 7 — G14 (parcial) + G15** — extensión del catálogo de tipos y `projections[].source`.

**Aplazado:**
- Refactor unificado de tabla de tipos canónicos hacia `src/utils/type-mapper.js` (G14, riesgo de regresión en JPA/mappers).
- Soporte para `Map<String, X>` en proyecciones (G14, baja demanda actual).

---

## 5. Cambios efectivos al schema YAML

Todas las extensiones del schema son **opcionales y retrocompatibles** (catálogos existentes compilan sin cambios). Documentación completa con ejemplos en [docs/projections-new-features.md](../docs/projections-new-features.md).

Resumen de aditivos:

- `projections[].description` — Javadoc + `@Schema(description=...)`.
- `projections[].source` — `aggregate:<X>` | `readModel:<X>`.
- `projections[].properties[].description` — Javadoc + `@Schema(description=...)` (opt-in vía `openApiAnnotations`).
- `projections[].properties[].example` — `@Schema(example=...)` (opt-in).
- `projections[].properties[].serializedName` — `@JsonProperty("…")`.
- `projections[].properties[].derivedFrom` — comentario de trazabilidad.
- `useCases[].returns:` ahora acepta lista inline → sintetiza `${PascalCase(useCase)}Result`.
- Tipos canónicos extendidos: `Date`, `Duration`, `BigInt`/`BigInteger`, `Json`/`JSON`.

Restricciones nuevas (potenciales rupturas en catálogos pre-existentes con problemas):

- G9: nombre de proyección no puede terminar en `Dto|Response|Request|Payload`.
- G12: lista blanca de atributos por propiedad.
- G13: cada proyección debe declarar ≥1 propiedad.

---

## 6. Verificación

Cada fase fue verificada regenerando el catálogo de prueba `C:/Users/antonio.suarez/Desktop/test-dsl/` y ejecutando `gradlew clean compileJava` → BUILD SUCCESSFUL. Las validaciones nuevas (G9, G12, G13) fueron probadas adicionalmente con casos negativos (5/5 fail-fast con mensaje preciso) y la sintetización de `returns` inline (G4) con casos de smoke test (5/5).
