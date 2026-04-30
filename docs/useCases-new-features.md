# Nuevas características soportadas en archivos de diseño — Use Cases

Este documento describe las extensiones del schema YAML de Bounded Context introducidas por la **Fase 1** del plan de remediación de `useCases[]` (ver [analisis/useCases-analisis.md](../analisis/useCases-analisis.md)). Todas las extensiones son **opcionales** y **retrocompatibles**: los `{bc}.yaml` existentes siguen produciendo exactamente el mismo código sin modificaciones.

> Las reglas siguen siendo declarativas, deterministas y agnósticas a la tecnología: si el YAML no provee el _hint_ necesario, el generador NO infiere — emite `// TODO useCase(<id>, <aspecto>): <causa>` (ver [AGENTS.md](../AGENTS.md)).

---

## Índice

1. [`returns` en commands — POST que devuelve el recurso creado (G4)](#1-returns-en-commands--post-que-devuelve-el-recurso-creado-g4)
2. [`errors[]` con whitelist estricta y `httpStatus` enumerado (G1 + G18)](#2-errors-con-whitelist-estricta-y-httpstatus-enumerado-g1--g18)
3. [Trazabilidad `derived_from` en errores de dominio (G1 cont.)](#3-trazabilidad-derived_from-en-errores-de-dominio-g1-cont)
4. [Limitaciones (lo que sigue NO soportado)](#4-limitaciones-lo-que-sigue-no-soportado)

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

## 4. Limitaciones (lo que sigue NO soportado)

Estos gaps están identificados en [analisis/useCases-analisis.md](../analisis/useCases-analisis.md) pero **NO** están cubiertos en Fase 1. Si el YAML los declara, el generador emite `// TODO useCase(<id>, <aspecto>)` y nunca infiere.

| Gap | Tema                                            | Fase prevista |
| --- | ----------------------------------------------- | ------------- |
| G2  | `idempotency` (header `Idempotency-Key`, store) | Fase 2        |
| G3  | `authorization` (RBAC + ownership)              | Fase 2        |
| G5  | Defaults y tipado fuerte en query params        | Fase 3        |
| G6  | Multi-aggregate transactions / sagas locales    | Fase 5        |
| G7  | Pagination/sorting declarativos                 | Fase 3        |
| G8  | Filtros range/search/in                         | Fase 3        |
| G9  | Bulk operations                                 | Fase 4        |
| G10 | Async / job tracking                            | Fase 4        |
| G11 | `input.source: header`                          | Fase 3        |
| G12 | Multipart upload / streaming download           | Fase 4        |
| G15 | `trigger.kind: event` enriquecido               | Fase 4        |
| G16 | `description` para Javadoc                      | Fase 3        |
| G17 | `derived_from` en records y handlers            | Fase 3        |
| G19 | `correlationId` end-to-end HTTP→evento          | Fase 5        |
| G20 | Validaciones cross-field declarativas           | Fase 5        |
| G21 | Caché de queries                                | Fase 6        |
| G22 | Rate limiting                                   | Fase 6        |
| G23 | Niveles de logging por UC                       | Fase 6        |
| G24 | `Optional[X]` y `Void` en `returns`             | Fase 3        |

> Lógica de negocio compleja (más allá de CRUD) se sigue cubriendo con `implementation: scaffold` + `{bc}-flows.md`. La Fase 3 (IA) completa el `// TODO`. El generador NO debe intentar producir reglas de negocio no triviales.
