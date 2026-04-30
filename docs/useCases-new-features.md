# Nuevas características soportadas en archivos de diseño — Use Cases

Este documento describe las extensiones del schema YAML de Bounded Context introducidas por las **Fases 1 a 7** del plan de remediación de `useCases[]` (ver [analisis/useCases-analisis.md](../analisis/useCases-analisis.md)). Todas las extensiones son **opcionales** y **retrocompatibles**: los `{bc}.yaml` existentes siguen produciendo exactamente el mismo código sin modificaciones.

> Las reglas siguen siendo declarativas, deterministas y agnósticas a la tecnología: si el YAML no provee el _hint_ necesario, el generador NO infiere — emite `// TODO useCase(<id>, <aspecto>): <causa>` (ver [AGENTS.md](../AGENTS.md)).

---

## Índice

### Fase 1 — base contractual y errores HTTP

1. [`returns` en commands — POST que devuelve el recurso creado (G4)](#1-returns-en-commands--post-que-devuelve-el-recurso-creado-g4)
2. [`errors[]` con whitelist estricta y `httpStatus` enumerado (G1 + G18)](#2-errors-con-whitelist-estricta-y-httpstatus-enumerado-g1--g18)
3. [Trazabilidad `derived_from` en errores de dominio (G1 cont.)](#3-trazabilidad-derived_from-en-errores-de-dominio-g1-cont)

### Fase 7 — correlación y validaciones declarativas

4. [`correlationId` end-to-end HTTP → handler → eventos (G19)](#4-correlationid-end-to-end-http--handler--eventos-g19)
5. [Validaciones cross-field declarativas (G20)](#5-validaciones-cross-field-declarativas-g20)

### Fase 2 — higiene de schema y trazabilidad

6. [Validación de `actor` contra `system.yaml#/actors` (G14)](#6-validación-de-actor-contra-systemyamlactors-g14)
7. [`description` en UCs → Javadoc end-to-end (G16)](#7-description-en-ucs--javadoc-end-to-end-g16)
8. [`derived_from` obligatorio en commands, queries y handlers (G17)](#8-derived_from-obligatorio-en-commands-queries-y-handlers-g17)
9. [`returns: Optional[X]` y `returns: Void` (G24)](#9-returns-optionalx-y-returns-void-g24)

### Fase 3 — entrada HTTP rica y cierre cross-BC

10. [`input.default` y tipado fuerte en query params (G5)](#10-inputdefault-y-tipado-fuerte-en-query-params-g5)
11. [Pagination y sorting declarativos (G7)](#11-pagination-y-sorting-declarativos-g7)
12. [`input.source: header` (G11)](#12-inputsource-header-g11)
13. [Cierre cross-BC de `fkValidations[]` con ServicePort (G13)](#13-cierre-cross-bc-de-fkvalidations-con-serviceport-g13)

### Fase 4 — idempotencia y autorización

14. [`idempotency` declarativa (G2)](#14-idempotency-declarativa-g2)
15. [`authorization` — RBAC + ownership (G3)](#15-authorization--rbac--ownership-g3)

### Fase 5 — orquestación, lotes, async, multipart

16. [Multi-aggregate same-BC con `aggregates[]` + `steps[]` (G6)](#16-multi-aggregate-same-bc-con-aggregates--steps-g6)
17. [Bulk operations (G9)](#17-bulk-operations-g9)
18. [Async / job tracking (G10)](#18-async--job-tracking-g10)
19. [`File` + `BinaryStream` — multipart upload y download (G12)](#19-file--binarystream--multipart-upload-y-download-g12)

### Fase 6 — filtros declarativos y UCs reactivos

20. [`Range[T]` y `SearchText` — filtros declarativos (G8)](#20-ranget-y-searchtext--filtros-declarativos-g8)
21. [`trigger.kind: event` enriquecido (G15)](#21-triggerkind-event-enriquecido-g15)

### Cierre

22. [Limitaciones (lo que sigue NO soportado)](#22-limitaciones-lo-que-sigue-no-soportado)

---

## 1. `returns` en commands — POST que devuelve el recurso creado (G4)

Antes de Fase 1, todo `CommandHandler.handle()` retornaba `void`. Eso rompía el caso típico "POST `/categories` devuelve `201 Created` con el recurso creado" — el OpenAPI declaraba `responses.201.content.application/json` pero el controller respondía `void`.

A partir de Fase 1, un command puede declarar `returns: <DtoOrProjection>` y el generador propaga el tipo de retorno end-to-end por toda la cadena CQRS sin exponer `Spring`/anotaciones tecnológicas en el YAML.

### YAML

```yaml
useCases:
  - id: UC-CAT-001
    name: CreateCategory
    type: command
    actor: catalog-admin
    aggregate: Category
    method: create
    trigger:
      kind: http
      operationId: createCategory
    input:
      - name: name
        type: String
        source: body
        required: true
      - name: slug
        type: String
        source: body
        required: true
    rules: [CAT-RULE-001, CAT-RULE-002]
    returns: CategoryResponse        # ← nuevo
    implementation: full
```

`returns` admite las mismas formas que en queries:

| Forma                   | Significado                                        |
| ----------------------- | -------------------------------------------------- |
| `CategoryResponse`      | DTO de respuesta declarado en el OpenAPI público   |
| `ProductPriceSnapshot`  | Proyección declarada en `projections[]`            |
| `List[ProductSummary]`  | Lista de DTOs (genera `List<ProductSummaryDto>`)   |
| `Page[ProductSummary]`  | Página paginada (genera `PagedResponse<…>`)        |

> Si `returns` se omite, el comportamiento es exactamente el anterior: handler `void`, controller `void`. **Cero impacto retrocompatible.**

### Código generado

#### Command record — `CreateCategoryCommand.java`

```java
package co.com.asuarez.catalog.application.commands;

import co.com.asuarez.catalog.application.dtos.CategoryResponseDto;
import co.com.asuarez.shared.domain.interfaces.ReturningCommand;
import jakarta.validation.constraints.NotBlank;

// derived_from: useCases[UC-CAT-001]
public record CreateCategoryCommand(
        @NotBlank String name,
        @NotBlank String slug
) implements ReturningCommand<CategoryResponseDto> {
}
```

> Cuando `returns` está ausente: `implements Command` (sin parámetro de tipo).

#### Handler — `CreateCategoryCommandHandler.java`

```java
@ApplicationComponent
@LogExceptions
public class CreateCategoryCommandHandler
        implements ReturningCommandHandler<CreateCategoryCommand, CategoryResponseDto> {

    private final CategoryRepository categoryRepository;

    @Override
    @Transactional
    public CategoryResponseDto handle(CreateCategoryCommand command) {
        // … lógica de negocio derivada del YAML …
        // TODO useCase(UC-CAT-001, returns): map result to CategoryResponseDto
        return null;
    }
}
```

> El generador inserta el `// TODO returns:` cuando `implementation: full` y el cuerpo no produce naturalmente el DTO. Si `implementation: scaffold`, sigue lanzando `UnsupportedOperationException` como siempre.

#### Controller — `CategoryV1Controller.java`

```java
@PostMapping("/categories")
public CategoryResponseDto createCategory(@RequestBody @Valid CategoryRequestDto body) {
    var command = new CreateCategoryCommand(body.name(), body.slug());
    return useCaseMediator.dispatch(command);
}
```

> El `return` aparece sólo cuando `returns` está declarado. Si no, el controller mantiene `public void` y `useCaseMediator.dispatch(command);` sin `return`.

#### Infraestructura compartida (generada una vez por proyecto)

Se generan dos nuevas interfaces en `shared/domain/interfaces/`:

```java
public interface ReturningCommand<R> extends Dispatchable {
}

public interface ReturningCommandHandler<C extends ReturningCommand<R>, R> extends Handler {
    R handle(C command);
}
```

Y `UseCaseMediator` adquiere una tercera sobrecarga `dispatch`:

```java
public <R, C extends ReturningCommand<R>> R dispatch(C command) {
    ReturningCommandHandler<C, R> instance =
            (ReturningCommandHandler<C, R>) useCaseContainer.resolve(command.getClass());
    if (instance == null) {
        throw new IllegalArgumentException("No handler registered for " + command.getClass());
    }
    return instance.handle(command);
}
```

`UseCaseAutoRegister` los descubre por `applicationContext.getBeansOfType(ReturningCommandHandler.class)` y los registra junto con los `CommandHandler` y `QueryHandler` ya existentes.

### Cuándo usarlo

- POST que devuelve el recurso creado (`201 Created` + body).
- PATCH que devuelve el estado actualizado.
- Cualquier command cuyo OpenAPI declare `responses.<2xx>.content.application/json`.

### Cuándo NO usarlo

- Commands fire-and-forget (`204 No Content`, eventos, jobs async). En ese caso se omite `returns` y se mantiene el contrato `void` actual.
- Si el resultado depende de lógica no trivial Fase 3, se sigue pudiendo declarar `returns: …` con `implementation: scaffold` — el handler queda con `UnsupportedOperationException` y la firma correcta para que la IA de Fase 3 implemente.

---

## 2. `errors[]` con whitelist estricta y `httpStatus` enumerado (G1 + G18)

`errors[]` ya existía como bloque para declarar errores de dominio con su `httpStatus`. Fase 1 endurece el contrato:

1. **Whitelist estricta de claves** — claves desconocidas (typos como `htppStatus:` o `descriptions:`) abortan el build con un error claro, en lugar de ser silenciosamente ignoradas.
2. **`httpStatus` con dominio cerrado** — sólo se aceptan `400`, `401`, `403`, `404`, `409`, `422`. Cualquier otro valor aborta el build.

### YAML

```yaml
errors:
  - code: CATEGORY_NOT_FOUND
    httpStatus: 404
    title: "Category not found"
    description: "El identificador de categoría no existe en el catálogo."

  - code: CATEGORY_NAME_ALREADY_EXISTS
    httpStatus: 409
    title: "Category name already in use"

  - code: INVALID_CATEGORY_TRANSITION
    httpStatus: 422
    title: "Invalid state transition for Category"
```

### Claves admitidas en cada entrada de `errors[]`

| Clave         | Tipo    | Obligatoria | Notas                                                                  |
| ------------- | ------- | ----------- | ---------------------------------------------------------------------- |
| `code`        | string  | ✅          | Identificador único; usado para nombrar la clase de error y el `code`  |
| `httpStatus`  | integer | ✅          | Uno de `400`, `401`, `403`, `404`, `409`, `422`                        |
| `title`       | string  | ❌          | Título RFC 7807                                                        |
| `description` | string  | ❌          | Descripción humana — emitida como Javadoc                              |
| `message`     | string  | ❌          | Mensaje por defecto si no se provee al instanciar                      |

> Cualquier otra clave produce: `bc-yaml-reader: unsupported attribute "<key>" in errors[<code>]`.

### Mapeo `httpStatus` → excepción base

El generador resuelve cada `httpStatus` a una excepción base preexistente del módulo `shared/`:

| `httpStatus` | Excepción base                          | `@RestControllerAdvice` HTTP |
| ------------ | --------------------------------------- | ---------------------------- |
| `400`        | `BadRequestException`                   | `400 Bad Request`            |
| `401`        | `UnauthorizedException`                 | `401 Unauthorized`           |
| `403`        | `ForbiddenException`                    | `403 Forbidden`              |
| `404`        | `NotFoundException`                     | `404 Not Found`              |
| `409`        | `ConflictException`                     | `409 Conflict`               |
| `422`        | `BusinessException`                     | `422 Unprocessable Entity`   |

### Código generado — `CategoryNotFoundError.java`

```java
package co.com.asuarez.catalog.domain.errors;

import co.com.asuarez.shared.domain.errors.NotFoundException;

// derived_from: errors[CATEGORY_NOT_FOUND]
public class CategoryNotFoundError extends NotFoundException {

    public CategoryNotFoundError(String message) {
        super("CATEGORY_NOT_FOUND", message);
    }
}
```

El `@RestControllerAdvice` (`HandlerExceptions.java`) ya está cableado para mapear cada base a su HTTP status correcto y emitir cuerpo RFC 7807. **No requiere intervención manual.**

---

## 3. Trazabilidad `derived_from` en errores de dominio (G1 cont.)

Cada clase de error generada incluye ahora la anotación de trazabilidad obligatoria de [AGENTS.md § 3](../AGENTS.md):

```java
// derived_from: errors[CATEGORY_NOT_FOUND]
public class CategoryNotFoundError extends NotFoundException { … }
```

Esto cierra una omisión histórica: los aggregates, value objects y domain events ya emitían `derived_from`, pero `errors[]` no lo hacía. Sin cambios en el YAML — la trazabilidad se deriva automáticamente de `errors[].code`.

---

## 4. `correlationId` end-to-end HTTP → handler → eventos (G19)

Antes, el `correlationId` sólo aparecía en los `EventEnvelope` salientes de mensajería (sagas, listeners). Las peticiones HTTP entrantes no abrían ningún contexto de correlación, así que cualquier evento publicado por un command/query iniciado vía REST se emitía sin `correlationId` y se rompía la trazabilidad de extremo a extremo.

A partir de Fase 7, el generador emite un **filtro HTTP de entrada** que abre el `CorrelationContext` (ThreadLocal + MDC) para cada petición. El valor se propaga a `MDC.get("correlationId")`, donde:

- los logs de aplicación lo emiten automáticamente,
- los `DomainEventHandler` lo leen al construir `EventMetadata.create(...)` para los eventos que el UC publica,
- los listeners de mensajería (Rabbit/Kafka) ya existentes cierran el ciclo cuando el evento cruza un BC.

### Activación

El filtro se genera **automáticamente** cuando hay sagas declaradas en `system.yaml#/sagas` (es decir, cuando ya se está generando `CorrelationContext.java`). No requiere ningún hint nuevo en `{bc}.yaml`. Si no hay sagas, no se emite — la baseline byte-clean se preserva.

### Contrato HTTP

| Aspecto                          | Comportamiento                                                                |
| -------------------------------- | ----------------------------------------------------------------------------- |
| Header de entrada                | `X-Correlation-Id` (case-insensitive)                                         |
| Si el header viene vacío/ausente | Se genera un `UUID v4` automáticamente                                        |
| Header de salida                 | `X-Correlation-Id` echo en la respuesta para que el cliente pueda registrarlo |
| Orden del filtro                 | `Ordered.HIGHEST_PRECEDENCE + 10` (antes de logging, idempotency, auth)       |
| Limpieza                         | `CorrelationContext.clear()` en `finally` — no fuga entre threads del pool    |

### Código generado — `CorrelationFilter.java`

```java
package co.com.asuarez.shared.infrastructure.web;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class CorrelationFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Correlation-Id";

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String correlationId = request.getHeader(HEADER);
        if (correlationId == null || correlationId.isBlank()) {
            correlationId = UUID.randomUUID().toString();
        }
        try {
            CorrelationContext.set(correlationId);
            response.setHeader(HEADER, correlationId);
            chain.doFilter(request, response);
        } finally {
            CorrelationContext.clear();
        }
    }
}
```

> Output: `shared/infrastructure/web/CorrelationFilter.java`. Se genera junto a `shared/infrastructure/correlation/CorrelationContext.java` por el `saga-generator`.

### Cuándo NO usarlo

Es transparente para el desarrollador: si las sagas están declaradas, todo command/query iniciado vía HTTP tiene correlación end-to-end automáticamente. No hay nada que apagar; si el cliente envía `X-Correlation-Id`, se respeta.

---

## 5. Validaciones cross-field declarativas (G20)

Las validaciones a nivel de campo (`@NotBlank`, `@Size`, `@Pattern`, etc.) ya se emiten desde el schema de `input[]`. Pero **las validaciones que cruzan dos o más campos del mismo command/query** (ej. "el SKU no puede coincidir con el nombre", "la fecha de fin debe ser posterior a la de inicio") no podían declararse en el YAML — quedaban como reglas implícitas que la Fase 3 debía descubrir leyendo `flows.md`.

A partir de Fase 7, cada UC puede declarar `validations[]` para enumerar estas guardas de forma trazable. El generador **no traduce la expresión a Java** — emite un `// TODO` literal en el handler, fiel al principio de no-inferencia de [AGENTS.md](../AGENTS.md). Pero la expresión, su `id` y el `errorCode` ligado quedan documentados en el código y trazables desde el YAML.

### YAML

```yaml
useCases:
  - id: UC-PRD-001
    name: CreateProduct
    type: command
    aggregate: Product
    method: create
    input:
      - { name: name, type: String(200), required: true, source: body }
      - { name: sku,  type: String(100), required: true, source: body }
      # …
    rules: [PRD-RULE-002, PRD-RULE-003]
    validations:                                                        # ← nuevo
      - id: skuVsName
        expression: "!command.sku().equalsIgnoreCase(command.name())"
        errorCode: PRODUCT_SKU_INVALID
        description: SKU must not match the product name (sanity check).
      - id: priceWithinRange
        expression: "command.price().amount().compareTo(BigDecimal.ZERO) > 0"
        errorCode: PRODUCT_PRICE_INVALID
    implementation: scaffold
```

### Schema admitido en cada entrada de `validations[]`

| Clave         | Tipo   | Obligatoria | Notas                                                                       |
| ------------- | ------ | ----------- | --------------------------------------------------------------------------- |
| `id`          | string | ✅          | Identificador único dentro del UC; se usa en el `// TODO` y para diagnóstico |
| `expression`  | string | ✅          | Expresión literal — el generador NO la traduce a Java                       |
| `errorCode`   | string | ✅          | Debe existir en `errors[]` (cross-validación estricta)                      |
| `description` | string | ❌          | Se emite como comentario adicional en el `// TODO`                          |

> Cualquier otra clave aborta el build. `id` debe ser único por UC. Si `errorCode` no existe en `errors[]`, el build falla con un mensaje claro.

### Código generado — `CreateProductCommandHandler.java`

```java
@Override
@Transactional
@LogExceptions
public void handle(CreateProductCommand command) {
    // [G20] cross-field validations — derived_from useCases[UC-PRD-001].validations[]
    // TODO useCase(UC-PRD-001, validations[skuVsName]): enforce expression `!command.sku().equalsIgnoreCase(command.name())` and throw the exception bound to errorCode "PRODUCT_SKU_INVALID" on violation. // SKU must not match the product name (sanity check).
    // TODO useCase(UC-PRD-001, validations[priceWithinRange]): enforce expression `command.price().amount().compareTo(BigDecimal.ZERO) > 0` and throw the exception bound to errorCode "PRODUCT_PRICE_INVALID" on violation.

    // TODO: implement business logic — ver catalog-flows.md
    throw new UnsupportedOperationException("Not implemented yet");
}
```

> Mismo patrón en `UcQueryHandler` cuando un query declara `validations[]`. La emisión del bloque es independiente de `implementation`: aparece tanto si es `scaffold` como si es `full`.

### Por qué literal y no traducido a Java

Traducir `expression` a Java exigiría parsear un mini-lenguaje y resolver tipos sobre el record del command — eso es **inferencia de dominio** y viola [AGENTS.md § 1](../AGENTS.md). El compromiso explícito es:

1. **El YAML declara la intención** — qué condición debe cumplirse y a qué error mapea.
2. **El generador documenta y referencia la intención** — `// TODO useCase(<id>, validations[<vid>])` deja un punto de implementación rastreable y testeable.
3. **La Fase 3 (IA o humano) traduce la expresión a código Java** usando `command.<getter>()`, `Objects`, etc.

Esto deja la regla declarada en un único lugar (el YAML) y el código generado siempre coherente con el diseño.

### Cuándo usarlo

- Reglas que cruzan dos o más campos del mismo command/query (`a != b`, `start < end`, `if x then y must be present`).
- Reglas que dependen del shape del input pero no son responsabilidad del aggregate (las reglas de aggregate van en `domainRules`).

### Cuándo NO usarlo

- Validaciones por campo individual — usa la sección `input[].required`/`type:` para que el generador emita `@NotBlank`, `@Size`, `@Min`, etc.
- Reglas de invariante del aggregate — usa `domainRules` del aggregate.
- Reglas que requieren consultar el repositorio (unicidad, FK existence) — usa `domainRules` con `type: uniqueness` o `fkValidations[]`.

---

## 6. Validación de `actor` contra `system.yaml#/actors` (G14)

`useCases[].actor` siempre fue obligatorio pero su contenido era texto libre. Una errata silenciosa (`oprator` en vez de `operator`) pasaba sin detectar. Desde Fase 2, `bc-yaml-reader.js` carga `system.yaml#/actors[]` y valida que cada `useCases[].actor` pertenezca al conjunto declarado a nivel sistema.

### YAML

`arch/system/system.yaml`:

```yaml
actors:
  - id: catalog-admin
    description: Operador interno del catálogo
  - id: end-user
    description: Cliente final
```

`arch/catalog/catalog.yaml`:

```yaml
useCases:
  - id: UC-CAT-001
    name: CreateCategory
    actor: catalog-admin   # ✅ existe en system.yaml
    # …
```

### Comportamiento

| Caso                                 | Resultado                                                                |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `actor` existe en `system.actors[]`  | Build OK                                                                 |
| `actor` no existe                    | Build aborta: `useCases[UC-CAT-001].actor "oprator" not declared in system.yaml#/actors` |
| `system.yaml` sin `actors[]`         | Comportamiento legacy preservado: no se valida                           |

> No requiere ningún cambio en los `{bc}.yaml` existentes que ya usan actores correctamente declarados.

---

## 7. `description` en UCs → Javadoc end-to-end (G16)

Hasta Fase 1, los records y handlers se generaban sin Javadoc — el lector del código no sabía qué hacía un UC sin abrir el `{bc}.yaml`. Desde Fase 2, `useCases[].description` se propaga como Javadoc al `Command`/`Query` record y al `*Handler`.

### YAML

```yaml
useCases:
  - id: UC-CAT-001
    name: CreateCategory
    type: command
    actor: catalog-admin
    description: |
      Crea una nueva categoría de catálogo. La unicidad por nombre se valida
      contra el repositorio. El slug se genera derivado de `name` cuando no
      se provee explícitamente.
    aggregate: Category
    method: create
    # …
```

### Código generado — `CreateCategoryCommand.java`

```java
/**
 * Crea una nueva categoría de catálogo. La unicidad por nombre se valida
 * contra el repositorio. El slug se genera derivado de `name` cuando no
 * se provee explícitamente.
 *
 * derived_from: useCases[UC-CAT-001]
 */
public record CreateCategoryCommand(
        @NotBlank String name,
        String slug
) implements Command {
}
```

> Sin `description` declarada, sólo se emite el comentario `// derived_from: useCases[UC-CAT-001]` (ver §8). Sin cambios para los `{bc}.yaml` existentes.

---

## 8. `derived_from` obligatorio en commands, queries y handlers (G17)

Aggregates, value objects y domain events ya emitían `derived_from`. Los UCs no — y eso violaba la regla 3 de [AGENTS.md](../AGENTS.md). Desde Fase 2, **todo** `Command`, `Query`, `CommandHandler` y `QueryHandler` incluye trazabilidad al `useCases[<id>]` del que se deriva.

### Código generado

```java
// derived_from: useCases[UC-CAT-001]
public record CreateCategoryCommand(...) implements Command { }
```

```java
// derived_from: useCases[UC-CAT-001]
@ApplicationComponent
@LogExceptions
public class CreateCategoryCommandHandler implements CommandHandler<CreateCategoryCommand> {
    // …
}
```

Cuando `description` está presente (§7), el `derived_from` aparece dentro del bloque Javadoc (`@derived_from` style, ver §7). No requiere ningún hint nuevo en el YAML — la trazabilidad se deriva automáticamente del `id`.

---

## 9. `returns: Optional[X]` y `returns: Void` (G24)

`returns` ya admitía `Page[X]`, `List[X]` y nombres de DTO/proyección. Faltaban dos formas comunes:

- **`Optional[X]`** — el query puede no encontrar el recurso (`200 OK` vs `404 Not Found` natural sin lanzar excepción).
- **`Void`** — explicitar que un command/query no retorna nada (equivalente a omitir `returns`, pero más legible).

Desde Fase 2, ambos están reconocidos.

### YAML

```yaml
useCases:
  - id: UC-CAT-005
    name: FindCategoryBySlug
    type: query
    aggregate: Category
    trigger: { kind: http, operationId: findCategoryBySlug }
    input:
      - { name: slug, type: String, source: query, required: true }
    returns: Optional[CategoryResponse]   # ← nuevo
    implementation: full
```

### Código generado

#### Handler — `FindCategoryBySlugQueryHandler.java`

```java
@Override
@Transactional(readOnly = true)
public Optional<CategoryResponseDto> handle(FindCategoryBySlugQuery query) {
    return categoryRepository.findBySlug(query.slug())
            .map(applicationMapper::toResponseDto);
}
```

#### Controller — `CategoryV1Controller.java`

```java
@GetMapping("/categories/by-slug")
public ResponseEntity<CategoryResponseDto> findCategoryBySlug(@RequestParam String slug) {
    var query = new FindCategoryBySlugQuery(slug);
    return useCaseMediator.dispatch(query)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
}
```

> El controller suprime cualquier `@ResponseStatus` — el `ResponseEntity` gobierna `200`/`404` según presencia.

#### `returns: Void`

Normaliza al comportamiento default sin `returns`: handler devuelve `void`, controller devuelve `void`. Útil sólo para legibilidad del YAML.

---

## 10. `input.default` y tipado fuerte en query params (G5)

Hasta Fase 2, los query params siempre llegaban como `String` y el handler tenía que reconstruir el parser manualmente (`MyEnum.valueOf(...)` con `if (status != null)`). Si el OpenAPI declaraba `default: ACTIVE`, no se honraba. Desde Fase 3, dos hints nuevos cierran la brecha:

- **`default: <literal>`** — propaga `defaultValue` al `@RequestParam`.
- **`max: <int>`** — emite `@Max(<n>)` en el record.

Además, cuando `type` referencia un enum del BC con `source: query`, el controller emite el enum directamente (no `String`), eliminando el parser manual del handler.

### YAML

```yaml
useCases:
  - id: UC-PRD-004
    name: ListProducts
    type: query
    aggregate: Product
    trigger: { kind: http, operationId: listProducts }
    input:
      - { name: status,     type: ProductStatus, source: query, default: ACTIVE }
      - { name: page,       type: Integer,       source: query, default: 0 }
      - { name: size,       type: Integer,       source: query, default: 20, max: 100 }
    returns: Page[ProductSummary]
    implementation: full
```

### Código generado

#### Query record — `ListProductsQuery.java`

```java
// derived_from: useCases[UC-PRD-004]
public record ListProductsQuery(
        ProductStatus status,
        @Max(100) int page,
        @Max(100) int size
) implements Query<Page<ProductSummary>> {
}
```

#### Controller

```java
@GetMapping("/products")
public PagedResponse<ProductSummaryDto> listProducts(
        @RequestParam(defaultValue = "ACTIVE") ProductStatus status,
        @RequestParam(defaultValue = "0") int page,
        @RequestParam(defaultValue = "20") int size) {
    var query = new ListProductsQuery(status, page, size);
    return PagedResponse.of(useCaseMediator.dispatch(query), applicationMapper::toResponseDto);
}
```

> Sin `default` ni `max`: comportamiento legacy. Sin tipado fuerte (campo `String`), comportamiento legacy.

---

## 11. Pagination y sorting declarativos (G7)

La heurística mágica anterior detectaba `page`/`size` por nombre de campo. Desde Fase 3, hay un bloque dedicado `pagination` con whitelist de campos ordenables.

### YAML

```yaml
useCases:
  - id: UC-PRD-004
    name: ListProducts
    type: query
    aggregate: Product
    trigger: { kind: http, operationId: listProducts }
    input:
      - { name: status, type: ProductStatus, source: query, default: ACTIVE }
    pagination:                                  # ← nuevo
      defaultSize: 20
      maxSize: 100
      sortable: [createdAt, price, name]
      defaultSort: { field: createdAt, direction: DESC }
    returns: Page[ProductSummary]
```

### Schema admitido

| Clave         | Tipo                          | Notas                                                           |
| ------------- | ----------------------------- | --------------------------------------------------------------- |
| `defaultSize` | int                           | Tamaño default si el cliente no lo provee                       |
| `maxSize`     | int                           | Emite `@Max(<n>)` en el campo `size`                            |
| `sortable[]`  | lista de nombres de campo     | Whitelist — `sortBy` fuera de la lista lanza `BadRequestException` |
| `defaultSort` | `{ field, direction }`        | `direction ∈ {ASC, DESC}`                                       |

### Código generado

#### Controller

```java
@GetMapping("/products")
public PagedResponse<ProductSummaryDto> listProducts(
        @RequestParam(defaultValue = "ACTIVE") ProductStatus status,
        @RequestParam(defaultValue = "0") int page,
        @RequestParam(defaultValue = "20") @Max(100) int size,
        @RequestParam(defaultValue = "createdAt") String sortBy,
        @RequestParam(defaultValue = "DESC") String sortDirection) {
    if (!Set.of("createdAt", "price", "name").contains(sortBy)) {
        throw new BadRequestException("Invalid sortBy: " + sortBy);
    }
    var query = new ListProductsQuery(status, page, size, sortBy, sortDirection);
    return PagedResponse.of(useCaseMediator.dispatch(query), applicationMapper::toResponseDto);
}
```

> Limitación documentada: para que `Sort` se propague al repo, el método de repositorio debe declarar `Pageable`. Cuando el repo legacy declara `int page, int size`, los campos llegan al controller pero no al repo (preservado por retrocompat).

---

## 12. `input.source: header` (G11)

Antes sólo se aceptaban `body | path | query | authContext`. Desde Fase 3, también `header` para mapear headers HTTP arbitrarios (`X-Tenant-Id`, `Accept-Language`, etc.).

### YAML

```yaml
useCases:
  - id: UC-PRD-001
    name: CreateProduct
    type: command
    aggregate: Product
    method: create
    trigger: { kind: http, operationId: createProduct }
    input:
      - name: tenantId
        type: Uuid
        source: header
        headerName: X-Tenant-Id
        required: true
      - name: name
        type: String
        source: body
        required: true
      # …
```

### Código generado — controller

```java
@PostMapping("/products")
public void createProduct(
        @RequestHeader(value = "X-Tenant-Id", required = true) UUID tenantId,
        @RequestBody @Valid ProductRequestDto body) {
    var command = new CreateProductCommand(tenantId, body.name(), /* … */);
    useCaseMediator.dispatch(command);
}
```

`headerName` es obligatorio cuando `source: header`. El campo se incluye en el record del Command/Query como cualquier otro input.

---

## 13. Cierre cross-BC de `fkValidations[]` con ServicePort (G13)

`fkValidations[]` ya generaba el `ServicePort` cross-BC. Pero el handler se quedaba con `// TODO call inventoryServicePort.existsCategory(...)` aun cuando todo estaba disponible. Desde Fase 3, cuando `fkValidations[i].bc` está declarado y el ServicePort expone `existsX(UUID)`, el handler emite la **llamada real**.

### YAML

```yaml
useCases:
  - id: UC-INV-001
    name: AdjustStock
    type: command
    aggregate: InventoryItem
    method: adjust
    trigger: { kind: http, operationId: adjustStock }
    input:
      - { name: productId, type: Uuid, source: path, required: true }
      - { name: delta,     type: Integer, source: body, required: true }
    fkValidations:
      - aggregate: Product
        param: productId
        bc: catalog                   # ← cross-BC: llama a CatalogServicePort
        notFoundError: ProductNotFound
    implementation: full
```

### Código generado — `AdjustStockCommandHandler.java`

```java
@Override
@Transactional
public void handle(AdjustStockCommand command) {
    if (!catalogServicePort.existsProduct(command.productId())) {
        throw new ProductNotFoundError("Product " + command.productId() + " not found");
    }
    // … resto de la lógica del handler …
}
```

> Sin `bc:` declarado, comportamiento local sin cambios (repo directo del mismo BC).

---

## 14. `idempotency` declarativa (G2)

Crítico para POST repetibles (pagos, órdenes). Desde Fase 4, un command puede declarar la deduplicación a nivel transporte.

### YAML

```yaml
useCases:
  - id: UC-PAY-001
    name: ChargeCard
    type: command
    aggregate: Payment
    method: charge
    trigger: { kind: http, operationId: chargeCard }
    idempotency:
      header: Idempotency-Key
      ttl: PT24H              # ISO-8601 duration
      storage: database       # database | redis
    input:
      - { name: amount,   type: Money,  source: body, required: true }
      - { name: cardId,   type: Uuid,   source: body, required: true }
    implementation: scaffold
```

### Schema admitido (`useCases[].idempotency`)

| Clave     | Valores                       | Notas                                              |
| --------- | ----------------------------- | -------------------------------------------------- |
| `header`  | string                        | Nombre del header HTTP (típicamente `Idempotency-Key`) |
| `ttl`     | string ISO-8601 (`PT24H`)     | Tiempo de retención de la respuesta cacheada       |
| `storage` | `database` \| `redis`         | Backend de persistencia                            |

> Sólo válido en commands. En queries el build aborta.

### Código generado

#### Controller — anotación `@Idempotent`

```java
@PostMapping("/payments/charge")
@Idempotent(header = "Idempotency-Key", ttl = "PT24H")
public void chargeCard(@RequestBody @Valid PaymentRequestDto body) {
    // …
}
```

#### Stack compartido (generado **una vez por proyecto** cuando ≥1 UC declara `idempotency`)

| Archivo                                                                | Contenido                                                                          |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `shared/infrastructure/web/Idempotent.java`                            | Anotación `@Idempotent`                                                            |
| `shared/infrastructure/web/IdempotencyFilter.java`                     | `OncePerRequestFilter` — SHA-256 del request, `ContentCachingResponseWrapper`, sólo cachea 2xx |
| `shared/infrastructure/web/IdempotencyStore.java`                      | Interfaz                                                                           |
| `shared/infrastructure/web/JdbcIdempotencyStore.java`                  | Impl JDBC (cuando `storage: database`)                                             |
| `shared/infrastructure/database/IdempotencyRequestJpa.java` + Repo     | Entidad JPA                                                                        |
| `db/migration/V3__request_idempotency.sql`                             | Migración Flyway                                                                   |

> Sin ningún UC con `idempotency` declarado: **cero archivos** emitidos (retrocompat byte-clean).

---

## 15. `authorization` — RBAC + ownership (G3)

El campo `actor` siempre fue documental. La autorización real (qué roles pueden invocar el UC, y si el recurso pertenece al usuario actual) no estaba declarada. Desde Fase 4, `authorization` cierra la brecha.

### YAML

```yaml
useCases:
  - id: UC-ORD-005
    name: CancelOrder
    type: command
    aggregate: Order
    method: cancel
    trigger: { kind: http, operationId: cancelOrder }
    authorization:
      rolesAnyOf: [CUSTOMER, OPERATOR]
      ownership:
        field: customerId          # propiedad del aggregate cargado
        claim: sub                 # claim del JWT del usuario actual
        allowRoleBypass: [OPERATOR] # roles que se saltan el chequeo de ownership
    input:
      - { name: orderId, type: Uuid, source: path, required: true, loadAggregate: true }
    notFoundError: OrderNotFound
    implementation: full
```

### Schema admitido (`useCases[].authorization`)

| Clave              | Notas                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| `rolesAnyOf[]`     | Genera `@PreAuthorize("hasAnyRole('R1','R2')")` en el endpoint         |
| `ownership.field`  | Propiedad del aggregate cargado vía `loadAggregate: true`              |
| `ownership.claim`  | Nombre del claim JWT a comparar (`sub`, `userId`, etc.)                |
| `ownership.allowRoleBypass[]` | Roles que omiten el guard de ownership (operadores, admins) |

### Código generado

#### Controller

```java
@PostMapping("/orders/{orderId}/cancel")
@PreAuthorize("hasAnyRole('CUSTOMER','OPERATOR')")
public void cancelOrder(@PathVariable UUID orderId) {
    useCaseMediator.dispatch(new CancelOrderCommand(orderId));
}
```

#### Handler — guard de ownership tras `loadAggregate`

```java
@Override
@Transactional
public void handle(CancelOrderCommand command) {
    Order order = orderRepository.findById(command.orderId())
            .orElseThrow(() -> new OrderNotFoundError("Order " + command.orderId() + " not found"));
    if (!SecurityContextUtil.hasAnyRole("OPERATOR")
            && !Objects.equals(String.valueOf(order.customerId()),
                                SecurityContextUtil.currentUserClaim("sub"))) {
        throw new ForbiddenException("Only the order owner can cancel");
    }
    // … lógica del handler …
}
```

> En query handlers que retornan `Optional[X]`, el ownership force-promueve el path a `orElseThrow` (no se puede chequear ownership sobre `Optional.empty()`). Sin `authorization` declarado: cero referencias en controllers/handlers (retrocompat preservada).

#### Infraestructura compartida

`shared/infrastructure/security/SecurityContextUtil.java` se genera incondicionalmente y expone:

```java
public static String currentUserClaim(String name) { /* lee Jwt principal */ }
public static boolean hasAnyRole(String... roles) { /* … */ }
```

---

## 16. Multi-aggregate same-BC con `aggregates[]` + `steps[]` (G6)

Para "transacción local con dos agregados en el mismo BC" (válido en DDD si comparten consistency boundary). Desde Fase 5, un UC puede declarar el array de agregados y los pasos.

### YAML

```yaml
useCases:
  - id: UC-ORD-010
    name: ConfirmOrderWithInventory
    type: command
    actor: end-user
    aggregates: [Order, Inventory]                # ← array
    steps:                                        # ← orquestación
      - aggregate: Order
        method: confirm
      - aggregate: Inventory
        method: reserve
        onFailure:
          compensate: { aggregate: Order, method: cancel }
    trigger: { kind: http, operationId: confirmOrder }
    input:
      - { name: orderId, type: Uuid, source: path, required: true }
    implementation: scaffold
```

### Schema admitido

| Clave                                       | Notas                                                       |
| ------------------------------------------- | ----------------------------------------------------------- |
| `aggregates[]`                              | ≥1 aggregate; con un solo elemento mantiene comportamiento single-aggregate |
| `steps[].aggregate`                         | Debe estar en `aggregates[]`                                |
| `steps[].method`                            | Método de negocio del aggregate                             |
| `steps[].onFailure.compensate.aggregate`    | Aggregate sobre el que compensar                            |
| `steps[].onFailure.compensate.method`       | Método de compensación                                      |

### Código generado — `ConfirmOrderWithInventoryCommandHandler.java`

```java
@Override
@Transactional
public void handle(ConfirmOrderWithInventoryCommand command) {
    Order order = orderRepository.findById(command.orderId())
            .orElseThrow(() -> new OrderNotFoundError(/* … */));
    Inventory inventory = inventoryRepository.findById(/* … */)
            .orElseThrow(/* … */);

    try {
        // step 1
        order.confirm();
        // step 2
        inventory.reserve();
    } catch (RuntimeException ex) {
        // TODO useCase(UC-ORD-010, steps[1].onFailure): compensate Order.cancel()
        order.cancel();
        throw ex;
    }

    orderRepository.save(order);
    inventoryRepository.save(inventory);
}
```

> Para sagas distribuidas (cross-BC) se sigue usando `system.yaml#/sagas`. Este bloque es sólo para coordinación local.

---

## 17. Bulk operations (G9)

Para "POST `/products/bulk` que crea N productos en un solo request con error reporting por item".

### YAML

```yaml
useCases:
  # UC base reutilizado por el bulk
  - id: UC-PRD-001
    name: CreateProduct
    type: command
    aggregate: Product
    method: create
    # … inputs body …

  - id: UC-PRD-020
    name: BulkCreateProducts
    type: command
    aggregate: Product
    bulk:
      itemType: CreateProductCommand   # debe ser un command no-bulk del mismo BC
      maxItems: 1000
      onItemError: continue            # continue | abort
    trigger: { kind: http, operationId: bulkCreateProducts }
    implementation: full
```

### Código generado

#### Command — `BulkCreateProductsCommand.java`

```java
public record BulkCreateProductsCommand(
        @Valid @Size(max = 1000) List<CreateProductCommand> items
) implements ReturningCommand<BulkResult<UUID>> { }
```

#### Handler — itera y acumula

```java
@Override
@Transactional
public BulkResult<UUID> handle(BulkCreateProductsCommand command) {
    BulkResult<UUID> result = new BulkResult<>();
    int index = 0;
    for (CreateProductCommand item : command.items()) {
        try {
            UUID id = useCaseMediator.dispatch(item);
            result.addSuccess(id);
        } catch (RuntimeException ex) {
            result.addError(index, ex);
            if (/* onItemError == abort */ false) throw ex;
        }
        index++;
    }
    return result;
}
```

#### Controller

```java
@PostMapping("/products/bulk")
public BulkResult<UUID> bulkCreateProducts(@RequestBody @Valid BulkCreateProductsCommand body) {
    return useCaseMediator.dispatch(body);
}
```

> `BulkResult<T>` es un record compartido en `shared/application/` con `successes: List<T>` + `errors: List<{ index, code, message }>`.

---

## 18. Async / job tracking (G10)

Para operaciones largas (export CSV, recálculos, llamadas a sistemas externos lentos) — devolver `202 Accepted` con un `jobId` consultable.

### YAML

```yaml
useCases:
  - id: UC-RPT-001
    name: GenerateMonthlyReport
    type: command
    aggregate: Report
    method: generate
    async:
      mode: jobTracking              # jobTracking | fireAndForget
      statusEndpoint: getReportJobStatus
    trigger: { kind: http, operationId: generateMonthlyReport }
    input:
      - { name: month, type: String, source: body, required: true }
    implementation: scaffold
```

### Schema admitido

| Clave            | Valores                          | Notas                                                          |
| ---------------- | -------------------------------- | -------------------------------------------------------------- |
| `mode`           | `jobTracking` \| `fireAndForget` | `jobTracking` retorna `JobReference`; `fireAndForget` retorna `void` |
| `statusEndpoint` | `operationId` del OpenAPI        | Endpoint de consulta del status del job                        |

### Código generado

```java
@Override
@Transactional
public JobReference handle(GenerateMonthlyReportCommand command) {
    UUID jobId = UUID.randomUUID();
    // TODO useCase(UC-RPT-001, async): offload via @Async / @Scheduled / message consumer
    return new JobReference(jobId);
}
```

```java
@PostMapping("/reports/monthly")
@ResponseStatus(HttpStatus.ACCEPTED)
public JobReference generateMonthlyReport(@RequestBody @Valid ReportRequestDto body) {
    return useCaseMediator.dispatch(new GenerateMonthlyReportCommand(body.month()));
}
```

> El worker concreto (`@Async`, `@Scheduled`, consumer de cola) **no se infiere** — Fase 3.

---

## 19. `File` + `BinaryStream` — multipart upload y download (G12)

Subir imagen de producto, descargar export CSV, etc.

### YAML — upload

```yaml
useCases:
  - id: UC-PRD-030
    name: UploadProductImage
    type: command
    aggregate: Product
    method: attachImage
    trigger: { kind: http, operationId: uploadProductImage }
    input:
      - { name: productId, type: Uuid, source: path, required: true }
      - name: image
        type: File                       # ← tipo canónico
        source: multipart                # ← nuevo
        partName: file
        maxSize: 5MB
        contentTypes: [image/png, image/jpeg]
    implementation: scaffold
```

### YAML — download

```yaml
useCases:
  - id: UC-PRD-031
    name: DownloadProductImage
    type: query
    aggregate: Product
    trigger: { kind: http, operationId: downloadProductImage }
    input:
      - { name: productId, type: Uuid, source: path, required: true }
    returns: BinaryStream                 # ← nuevo
    implementation: full
```

### Schema admitido

| Clave            | Notas                                                                |
| ---------------- | -------------------------------------------------------------------- |
| `source: multipart` | Sólo válido cuando `type: File`. Mutuamente excluyente con `body` |
| `partName`       | Nombre de la parte multipart                                         |
| `maxSize`        | `<num><unit>` con `unit ∈ {B, KB, MB, GB}` (ej. `5MB`)               |
| `contentTypes[]` | Whitelist de MIME types                                              |
| `returns: BinaryStream` | Sólo válido en queries — emite `Resource` + `application/octet-stream` |

### Código generado — upload

```java
@PostMapping(path = "/products/{productId}/image",
             consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
public void uploadProductImage(
        @PathVariable UUID productId,
        @RequestPart("file") MultipartFile image) {
    if (image == null || image.isEmpty()) {
        throw new BadRequestException("image is required");
    }
    if (image.getSize() > 5L * 1024 * 1024) {
        throw new BadRequestException("image exceeds 5MB");
    }
    if (!Set.of("image/png", "image/jpeg").contains(image.getContentType())) {
        throw new BadRequestException("Unsupported content type: " + image.getContentType());
    }
    useCaseMediator.dispatch(new UploadProductImageCommand(productId, image));
}
```

### Código generado — download

```java
@GetMapping("/products/{productId}/image")
public ResponseEntity<Resource> downloadProductImage(@PathVariable UUID productId) {
    Resource resource = useCaseMediator.dispatch(new DownloadProductImageQuery(productId));
    return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .body(resource);
}
```

---

## 20. `Range[T]` y `SearchText` — filtros declarativos (G8)

Filtros tipo `priceMin`/`priceMax`, `createdAfter`/`createdBefore`, búsqueda full-text por varios campos.

### YAML

```yaml
useCases:
  - id: UC-PRD-004
    name: ListProducts
    type: query
    aggregate: Product
    trigger: { kind: http, operationId: listProducts }
    input:
      - name: priceRange
        type: Range[Decimal]              # ← Range[T] canónico
        source: query
      - name: createdRange
        type: Range[DateTime]
        source: query
      - name: search
        type: SearchText                  # ← canónico
        fields: [name, description]       # campos del aggregate a buscar
        source: query
    pagination: { defaultSize: 20, maxSize: 100, sortable: [createdAt, price] }
    returns: Page[ProductSummary]
```

### Tipos canónicos admitidos

| Tipo            | Java                       | Notas                                                                |
| --------------- | -------------------------- | -------------------------------------------------------------------- |
| `Range[Decimal]`  | `Range<BigDecimal>`        | Record genérico shared `Range<T>(T min, T max)`                      |
| `Range[Integer]`  | `Range<Integer>`           | Idem                                                                 |
| `Range[DateTime]` | `Range<OffsetDateTime>`    | Idem                                                                 |
| `SearchText`      | `String`                   | El campo `fields[]` documenta a qué columnas buscar                  |

### Código generado

#### Controller — agrupa min/max en `Range`

```java
@GetMapping("/products")
public PagedResponse<ProductSummaryDto> listProducts(
        @RequestParam(required = false) BigDecimal priceRangeMin,
        @RequestParam(required = false) BigDecimal priceRangeMax,
        @RequestParam(required = false) OffsetDateTime createdRangeMin,
        @RequestParam(required = false) OffsetDateTime createdRangeMax,
        @RequestParam(required = false) String search) {
    var query = new ListProductsQuery(
            new Range<>(priceRangeMin, priceRangeMax),
            new Range<>(createdRangeMin, createdRangeMax),
            search);
    return PagedResponse.of(useCaseMediator.dispatch(query), applicationMapper::toResponseDto);
}
```

#### `infrastructure/persistence/specs/ProductSpecs.java` — generado automáticamente

```java
public final class ProductSpecs {
    private ProductSpecs() { }

    public static Specification<ProductJpa> bySearch(String text) {
        if (text == null || text.isBlank()) return null;
        String like = "%" + text.toLowerCase() + "%";
        return (root, q, cb) -> cb.or(
                cb.like(cb.lower(root.get("name")), like),
                cb.like(cb.lower(root.get("description")), like));
    }

    public static Specification<ProductJpa> byPriceRange(Range<BigDecimal> range) {
        if (range == null || (range.min() == null && range.max() == null)) return null;
        // TODO useCase(UC-PRD-004, filters[priceRange]): compose JPA path for Money.amount
        return null;
    }
    // …
}
```

> El cuerpo de `byRange*` queda con `// TODO` apuntando a la ruta JPA esperada (Phase 3 implementation). El cuerpo de `bySearch` es completo. Composición con `.and()` en handlers también queda para Phase 3.

---

## 21. `trigger.kind: event` enriquecido (G15)

UCs reactivos a eventos de dominio (ej. "ajustar stock cuando se crea una orden").

### YAML

```yaml
useCases:
  - id: UC-INV-005
    name: AdjustStockOnOrderPlaced
    type: command
    actor: system
    aggregate: Inventory
    method: adjust
    trigger:
      kind: event
      consumes: OrderPlaced
      fromBc: orders
      filter: "payload.totalAmount > 0"   # opcional, documental
    implementation: scaffold
```

### Schema admitido (`useCases[].trigger`)

| Clave        | Notas                                                                  |
| ------------ | ---------------------------------------------------------------------- |
| `kind`       | `http` \| `event`                                                      |
| `event`      | Alias compatible con `consumes`                                        |
| `consumes`   | Nombre del evento consumido (debe existir en `domainEvents.consumed[]` o cross-BC) |
| `fromBc`     | BC originador del evento                                               |
| `channel`    | Canal de mensajería (opcional)                                         |
| `filter`     | Expresión documental — emitida como TODO en el listener                |

> Cross-validación: el evento debe existir como consumido en el `{bc}.yaml` y/o estar declarado en el AsyncAPI.

### Código generado — `OrdersDomainEventHandler.java` (en BC `inventory`)

```java
@Component
@RabbitListener(queues = "inventory.orders.queue")
public class OrdersDomainEventHandler {

    @RabbitHandler
    public void on(OrderPlacedEvent event) {
        // TODO useCase(UC-INV-005, filter): apply expression `payload.totalAmount > 0`
        useCaseMediator.dispatch(new AdjustStockOnOrderPlacedCommand(/* … */));
    }
}
```

---

## 22. Limitaciones (lo que sigue NO soportado)

Estos gaps están identificados en [analisis/useCases-analisis.md](../analisis/useCases-analisis.md) pero **NO** están cubiertos. Si el YAML los declara, el generador emite `// TODO useCase(<id>, <aspecto>)` y nunca infiere.

| Gap | Tema                                            | Estado    |
| --- | ----------------------------------------------- | --------- |
| G21 | Caché de queries (`@Cacheable`/`@CacheEvict`)   | ⏳ Pendiente |
| G22 | Rate limiting / throttling                      | ⏳ Pendiente |
| G23 | Niveles de logging por UC (`@LogExceptions` granular) | ⏳ Pendiente |

> Lógica de negocio compleja (más allá de CRUD) se sigue cubriendo con `implementation: scaffold` + `{bc}-flows.md`. La Fase 3 (IA) completa el `// TODO`. El generador NO debe intentar producir reglas de negocio no triviales.
