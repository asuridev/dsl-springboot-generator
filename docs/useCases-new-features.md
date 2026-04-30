# Nuevas características soportadas en archivos de diseño — Use Cases

Este documento describe las extensiones del schema YAML de Bounded Context introducidas por la **Fase 1** del plan de remediación de `useCases[]` (ver [analisis/useCases-analisis.md](../analisis/useCases-analisis.md)). Todas las extensiones son **opcionales** y **retrocompatibles**: los `{bc}.yaml` existentes siguen produciendo exactamente el mismo código sin modificaciones.

> Las reglas siguen siendo declarativas, deterministas y agnósticas a la tecnología: si el YAML no provee el _hint_ necesario, el generador NO infiere — emite `// TODO useCase(<id>, <aspecto>): <causa>` (ver [AGENTS.md](../AGENTS.md)).

---

## Índice

1. [`returns` en commands — POST que devuelve el recurso creado (G4)](#1-returns-en-commands--post-que-devuelve-el-recurso-creado-g4)
2. [`errors[]` con whitelist estricta y `httpStatus` enumerado (G1 + G18)](#2-errors-con-whitelist-estricta-y-httpstatus-enumerado-g1--g18)
3. [Trazabilidad `derived_from` en errores de dominio (G1 cont.)](#3-trazabilidad-derived_from-en-errores-de-dominio-g1-cont)
4. [`correlationId` end-to-end HTTP → handler → eventos (G19)](#4-correlationid-end-to-end-http--handler--eventos-g19)
5. [Validaciones cross-field declarativas (G20)](#5-validaciones-cross-field-declarativas-g20)
6. [Limitaciones (lo que sigue NO soportado)](#6-limitaciones-lo-que-sigue-no-soportado)

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

## 6. Limitaciones (lo que sigue NO soportado)

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
| G21 | Caché de queries                                | Fase 6        |
| G22 | Rate limiting                                   | Fase 6        |
| G23 | Niveles de logging por UC                       | Fase 6        |
| G24 | `Optional[X]` y `Void` en `returns`             | Fase 3        |

> Lógica de negocio compleja (más allá de CRUD) se sigue cubriendo con `implementation: scaffold` + `{bc}-flows.md`. La Fase 3 (IA) completa el `// TODO`. El generador NO debe intentar producir reglas de negocio no triviales.
