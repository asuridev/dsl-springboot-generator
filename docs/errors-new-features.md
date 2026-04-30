# Nuevas características soportadas en archivos de diseño — Errors

Este documento describe las extensiones del schema YAML de Bounded Context introducidas por las **Fases 1 a 4** del plan de remediación de `errors[]` (ver [analisis/errors-analisis.md](../analisis/errors-analisis.md)). Todas las extensiones son **opcionales** y **retrocompatibles**: los `{bc}.yaml` existentes siguen produciendo exactamente el mismo código sin modificaciones.

> Las reglas siguen siendo declarativas, deterministas y agnósticas a la tecnología: si el YAML no provee el _hint_ necesario, el generador NO infiere — emite `// TODO error(<code>, <aspecto>): <causa>` con el nombre exacto de la clase Java a usar (ver [AGENTS.md](../AGENTS.md)).

---

## Índice

### Fase 1 — higiene base

1. [`errors[].errorType` — override del nombre de clase Java (E10)](#1-errorserrortype--override-del-nombre-de-clase-java-e10)
2. [`errors[].description` → Javadoc en la clase generada (E11)](#2-errorsdescription--javadoc-en-la-clase-generada-e11)
3. [Constructores `protected` en superclases compartidas (E12)](#3-constructores-protected-en-superclases-compartidas-e12)
4. [`errors[].chainable` — propagar excepción técnica original (E14)](#4-errorschainable--propagar-excepción-técnica-original-e14)
5. [`errors[].usedFor` + warning de huérfanos (E15)](#5-errorsusedfor--warning-de-huérfanos-e15)

### Fase 2 — mensaje y contrato

6. [`errors[].messageTemplate` + `errors[].args[]` — mensajes parametrizados (E3)](#6-errorsmessagetemplate--errorsargs--mensajes-parametrizados-e3)
7. [HTTP statuses extendidos (E4)](#7-http-statuses-extendidos-e4)
8. [`ErrorResponse` y `DomainException` estructurados (E2 parcial)](#8-errorresponse-y-domainexception-estructurados-e2-parcial)

### Fase 3 — emisión declarativa de throws

9. [`domainRules[].constraintName` — race-condition de DB (E6)](#9-domainrulesconstraintname--race-condition-de-db-e6)
10. [`useCases[].lookups[]` — múltiples lookups con error específico (E8)](#10-usecaseslookups--múltiples-lookups-con-error-específico-e8)
11. [`validations[].errorCode` ahora se emite como throw (E9)](#11-validationserrorcode-ahora-se-emite-como-throw-e9)
12. [`uniqueness` / `statePrecondition` / `deleteGuard` / `crossAggregateConstraint` con TODOs enriquecidos (E1.a–c)](#12-uniqueness--stateprecondition--deleteguard--crossaggregateconstraint-con-todos-enriquecidos-e1ac)
13. [`terminalState.errorCode` — traducción específica desde `InvalidStateTransitionException` (E1.d)](#13-terminalstateerrorcode--traducción-específica-desde-invalidstatetransitionexception-e1d)

### Fase 4 — infraestructura y trazabilidad

14. [`errors[].kind` + `errors[].triggeredBy` — errores de infraestructura declarables (E5)](#14-errorskind--errorstriggeredby--errores-de-infraestructura-declarables-e5)
15. [Catálogo inverso `docs/errors/{bc}-errors-catalog.md` (E7)](#15-catálogo-inverso-docserrorsbc-errors-catalogmd-e7)

---

## Esquema completo de `errors[]` (post-Fase 4)

```yaml
errors:
  - code: PRODUCT_NOT_FOUND          # ✅ requerido — SCREAMING_SNAKE_CASE, único en el BC
    httpStatus: 404                  # opcional — default 422 vía BusinessException
    description: |                   # opcional — emitida como Javadoc en la clase Java
      The requested product does not exist or has been deleted.
    errorType: ProductNotFoundError  # opcional — override del nombre derivado de `code`
    chainable: false                 # opcional — true añade ctor (Throwable cause)
    usedFor: auto                    # opcional — auto (default) | manual
    messageTemplate: "Product {id} not found"   # opcional — placeholders {arg}
    args:                            # opcional — requiere messageTemplate
      - { name: id, type: UUID }
    kind: business                   # opcional — business (default) | infrastructure
    triggeredBy: ""                  # opcional — sólo si kind: infrastructure
```

| Clave | Tipo | Default | Notas |
|---|---|---|---|
| `code` | string | — | SCREAMING_SNAKE_CASE; único |
| `httpStatus` | enum `400, 401, 402, 403, 404, 408, 409, 412, 415, 422, 423, 429, 503, 504` | 422 | Statuses extendidos enrutan a `DomainException` dinámico |
| `description` | string | ∅ | Renderizada como Javadoc |
| `errorType` | PascalCase identifier | derivado de `code` | Override del nombre de clase Java |
| `chainable` | boolean | `false` | Si `true`, genera ctor `(Throwable cause)` |
| `usedFor` | enum `auto\|manual` | `auto` | `manual` suprime warning de huérfano |
| `messageTemplate` | string con `{name}` placeholders | ∅ | Precompilado a expresión Java |
| `args[]` | lista de `{name, type}` | ∅ | Genera ctor parametrizado tipado; requiere `messageTemplate` |
| `kind` | enum `business\|infrastructure` | `business` | `infrastructure` requiere `triggeredBy` |
| `triggeredBy` | Java class name (FQN o simple) | ∅ | Excepción JVM que el advice traduce al error |

---

## 1. `errors[].errorType` — override del nombre de clase Java (E10)

Por defecto, `code: PRODUCT_NOT_FOUND` deriva la clase `ProductNotFoundError`. Si necesitas un nombre distinto (p.ej. para alinear con un cliente legacy):

```yaml
errors:
  - code: PRODUCT_NOT_FOUND
    httpStatus: 404
    errorType: ProductNotFoundException   # override
```

**Genera:** `domain/errors/ProductNotFoundException.java` (en lugar de `ProductNotFoundError.java`). Todas las referencias en handlers usan el nombre overridden automáticamente.

**Validación:** debe matchear `^[A-Z][A-Za-z0-9_]*$`.

---

## 2. `errors[].description` → Javadoc en la clase generada (E11)

```yaml
errors:
  - code: PRODUCT_NOT_ACTIVATABLE
    httpStatus: 422
    description: |
      The product cannot be activated. It must have a name,
      a valid price greater than zero, and at least one image.
```

**Genera:**

```java
/**
 * The product cannot be activated. It must have a name,
 * a valid price greater than zero, and at least one image.
 */
public class ProductNotActivatableError extends BusinessException {
    public ProductNotActivatableError() { super("PRODUCT_NOT_ACTIVATABLE"); }
}
```

Sin `description`: la clase se emite sin Javadoc (sin ruido).

---

## 3. Constructores `protected` en superclases compartidas (E12)

Las superclases (`BusinessException`, `NotFoundException`, `ConflictException`, `BadRequestException`, `UnauthorizedException`, `ForbiddenException`) tienen su ctor sin args marcado `protected`. Esto previene en compile-time:

```java
throw new BusinessException();  // ❌ ya no compila desde fuera del paquete shared
```

Forzando siempre el uso de subclases nominadas (`throw new ProductNotFoundError()`).

No requiere ningún cambio en el YAML — es una mejora del runtime compartido.

---

## 4. `errors[].chainable` — propagar excepción técnica original (E14)

```yaml
errors:
  - code: OUTBOX_PUBLISH_FAILED
    httpStatus: 503
    chainable: true
    description: Failed to publish event to the outbox.
```

**Genera:**

```java
public class OutboxPublishFailedError extends DomainException {
    public OutboxPublishFailedError() { super(...); }
    public OutboxPublishFailedError(Throwable cause) { super(..., cause); }   // ← nuevo
}
```

**Uso típico** (en código Fase 3):

```java
try {
    outboxRepository.publish(event);
} catch (DataAccessException ex) {
    throw new OutboxPublishFailedError(ex);   // preserva stack trace
}
```

---

## 5. `errors[].usedFor` + warning de huérfanos (E15)

El generador detecta automáticamente errores declarados que nunca son referenciados por ninguna `domainRule.errorCode`, `notFoundError`, `lookups[].errorCode`, `fkValidations[].error` ni `validations[].errorCode`.

```yaml
errors:
  - code: PRODUCT_RATE_LIMITED
    httpStatus: 429
    usedFor: manual         # suprime el warning
    description: Lanzado manualmente desde un interceptor custom.
```

| `usedFor` | Comportamiento |
|---|---|
| `auto` (default) | Si no hay referencias en el YAML → `WARN: error "<CODE>" is declared but never referenced` |
| `manual` | Sin warning. Indica que el throw lo escribirá el humano en Fase 3 |

> Errores con `kind: infrastructure` se excluyen automáticamente del warning (los lanza el advice global, no el código de aplicación).

---

## 6. `errors[].messageTemplate` + `errors[].args[]` — mensajes parametrizados (E3)

Antes: todas las clases tenían un único ctor `()` con mensaje estático (el código).
Ahora: se puede declarar un ctor parametrizado con interpolación segura.

```yaml
errors:
  - code: CATEGORY_NAME_ALREADY_EXISTS
    httpStatus: 409
    messageTemplate: "Category with name '{name}' already exists"
    args:
      - { name: name, type: String }
```

**Genera:**

```java
public class CategoryNameAlreadyExistsError extends ConflictException {
    public CategoryNameAlreadyExistsError() {
        super("CATEGORY_NAME_ALREADY_EXISTS");
    }
    public CategoryNameAlreadyExistsError(String name) {
        super("Category with name '" + String.valueOf(name) + "' already exists");
    }
}
```

**Uso:**

```java
throw new CategoryNameAlreadyExistsError(command.name());
```

**Validación:**

- `args[].name` debe ser camelCase Java identifier (`^[a-z][a-zA-Z0-9_]*$`).
- `args[].type` debe matchear un tipo Java válido (incluye `String`, `UUID`, `int`, `long`, `BigDecimal`, etc.).
- Sin nombres duplicados.
- Cada `{placeholder}` en `messageTemplate` debe corresponder a un `arg`.
- `args[]` no vacío requiere `messageTemplate`.

---

## 7. HTTP statuses extendidos (E4)

`ALLOWED_HTTP_STATUSES` ahora incluye 14 códigos:

```
400, 401, 402, 403, 404, 408, 409, 412, 415, 422, 423, 429, 503, 504
```

Los **nuevos** statuses (402, 408, 412, 415, 423, 429, 503, 504) extienden directamente `DomainException` y son capturados por un `@ExceptionHandler(DomainException.class)` genérico que lee el `httpStatus` desde la metadata estructurada — evitando la explosión de superclases.

```yaml
errors:
  - code: PAYMENT_REQUIRED
    httpStatus: 402
  - code: RATE_LIMIT_EXCEEDED
    httpStatus: 429
  - code: SERVICE_UNAVAILABLE
    httpStatus: 503
    chainable: true
```

---

## 8. `ErrorResponse` y `DomainException` estructurados (E2 parcial)

El runtime compartido fue alineado con el contrato OpenAPI:

- `ErrorResponse` ahora incluye campo `code` (machine-readable).
- `DomainException` expone getters `getCode()`, `getHttpStatus()`, `getArgs()`, `getDetails()`.
- `HandlerExceptions` rellena `code`/`message`/`details` desde la metadata estructurada del error.

**Respuesta HTTP de ejemplo** (POST /categories duplicada):

```json
{
  "status": 409,
  "error": "Conflict",
  "code": "CATEGORY_NAME_ALREADY_EXISTS",
  "message": "Category with name 'Electronics' already exists",
  "details": []
}
```

> 🟡 **Deferred**: la regeneración de `ErrorResponse.java` desde `*-open-api.yaml#/components/schemas/ErrorResponse` y el opt-in `errorFormat: problemDetails` (RFC 7807) quedan para una iteración futura. Sin esto, el cliente actual ya puede deserializar `code`/`message`/`details` correctamente.

---

## 9. `domainRules[].constraintName` — race-condition de DB (E6)

Para reglas de tipo `uniqueness`, declarar el nombre del constraint físico en BD permite que el advice traduzca `DataIntegrityViolationException` al error de dominio exacto:

```yaml
aggregates:
  - name: Category
    domainRules:
      - id: CAT-RULE-001
        type: uniqueness
        field: name
        errorCode: CATEGORY_NAME_ALREADY_EXISTS
        constraintName: uk_category_name      # ← nuevo
```

**Genera:**

a) En la entidad JPA:

```java
@Entity
@Table(
    name = "categories",
    uniqueConstraints = @UniqueConstraint(name = "uk_category_name", columnNames = "name")
)
public class CategoryJpa extends FullAuditableEntity { ... }
```

b) En el `HandlerExceptions` compartido:

```java
private static final Map<String, Supplier<? extends DomainException>> CONSTRAINT_TO_ERROR =
    Map.of("uk_category_name", CategoryNameAlreadyExistsError::new);

@ExceptionHandler(DataIntegrityViolationException.class)
public ResponseEntity<ErrorResponse> onDataIntegrityViolation(DataIntegrityViolationException ex) {
    String constraint = extractConstraintName(ex);
    DomainException domainEx = Optional.ofNullable(CONSTRAINT_TO_ERROR.get(constraint))
        .map(Supplier::get)
        .orElseGet(() -> new ConflictException("Data integrity violation"));
    // ... return ResponseEntity con código exacto
}
```

**Validación:** sólo permitido en `type: uniqueness`; requiere `field`; formato snake_case `^[a-z][a-z0-9_]*$`.

**Sin `constraintName`:** comportamiento legacy (409 genérico).

---

## 10. `useCases[].lookups[]` — múltiples lookups con error específico (E8)

Reemplaza `notFoundError` cuando un caso de uso tiene **varios** lookups, cada uno con su propio error:

```yaml
useCases:
  - id: UC-PRD-007
    name: AddProductImage
    aggregate: Product
    lookups:
      - param: id              # parámetro del path/command
        aggregate: Product
        errorCode: PRODUCT_NOT_FOUND
      - param: imageId
        nestedIn: Product.images   # entidad anidada en el agregado
        errorCode: PRODUCT_IMAGE_NOT_FOUND
```

**Genera** (en el handler):

```java
Product product = productRepository.findById(command.id())
    .orElseThrow(ProductNotFoundError::new);

// TODO useCase(UC-PRD-007, lookup): find image by imageId in product.images
//   throw new ProductImageNotFoundError(); when not found
```

**Validación:**

- Mutuamente exclusivo con `notFoundError` (declarar ambos falla).
- `param`s únicos.
- `nestedIn` debe matchear `^[A-Z]\w*\.[a-z]\w*$`.
- Cada `errorCode` debe existir en `errors[]`.

**Compatibilidad:** `notFoundError` (single-entry o array) sigue funcionando.

---

## 11. `validations[].errorCode` ahora se emite como throw (E9)

Antes: el reader validaba el cross-reference pero el handler emitía sólo un `// TODO`.
Ahora: si la `expression` parece una expresión booleana Java (`==`, `!=`, `<`, `>`, `&&`, `||`, `!`, `.isPresent()`, etc.), el throw se emite directo:

```yaml
useCases:
  - id: UC-PRM-001
    name: CreatePromotion
    validations:
      - id: V-001
        expression: "command.startDate().isBefore(command.endDate())"
        errorCode: INVALID_DATE_RANGE
```

**Genera:**

```java
// derived_from: validations[V-001]
if (!(command.startDate().isBefore(command.endDate()))) {
    throw new InvalidDateRangeError();
}
```

Si la expresión NO parece Java boolean → emite TODO enriquecido con el nombre exacto de la clase Java + ejemplo de throw para copy/paste.

---

## 12. `uniqueness` / `statePrecondition` / `deleteGuard` / `crossAggregateConstraint` con TODOs enriquecidos (E1.a–c)

Cuando una `domainRule` tiene `errorCode` pero falta el _hint_ para emitir el throw determinísticamente, el TODO ahora **nombra la clase Java exacta** y añade el `import` correspondiente:

```yaml
aggregates:
  - name: Product
    domainRules:
      - id: PRD-RULE-002
        type: deleteGuard
        errorCode: PRODUCT_CANNOT_BE_DELETED
        description: A product with active orders cannot be deleted.
```

**Genera** (en `DeleteProductCommandHandler`):

```java
import com.example.product.domain.errors.ProductCannotBeDeletedError;

// TODO domainRule(PRD-RULE-002, deleteGuard):
//   ejemplo: throw new ProductCannotBeDeletedError();
//   condición sugerida: si el producto tiene órdenes activas
//   ver: aggregate Product, domainRule PRD-RULE-002
```

**Con hints completos** (`targetAggregate` + `targetRepositoryMethod`), el throw se emite end-to-end. Cf. [aggregates-new-features.md](aggregates-new-features.md) §4.5.

Para `uniqueness` con `field`:

```yaml
domainRules:
  - id: CAT-RULE-001
    type: uniqueness
    field: name
    errorCode: CATEGORY_NAME_ALREADY_EXISTS
```

**Genera:**

```java
// derived_from: domainRule[CAT-RULE-001] uniqueness
if (categoryRepository.findByName(command.name()).isPresent()) {
    throw new CategoryNameAlreadyExistsError();
}
```

(En commands de update se usa `.ifPresent(other -> if (!other.getId().equals(aggregate.getId())) throw ...)`.)

---

## 13. `terminalState.errorCode` — traducción específica desde `InvalidStateTransitionException` (E1.d)

Cuando un agregado tiene `domainRules` de tipo `terminalState` con `errorCode`, las llamadas a `transitionTo(...)` son envueltas en try/catch que traduce la excepción genérica:

```yaml
aggregates:
  - name: Product
    domainRules:
      - id: PRD-RULE-004
        type: terminalState
        errorCode: PRODUCT_ALREADY_DISCONTINUED
        description: A discontinued product cannot transition to any other state.
```

**Genera** (en métodos de negocio del agregado, p.ej. `discontinue()`):

```java
public void discontinue() {
    try {
        this.status = this.status.transitionTo(ProductStatus.DISCONTINUED);
    } catch (InvalidStateTransitionException ex) {
        throw new ProductAlreadyDiscontinuedError();
    }
    // ... resto del método
}
```

Imports a `ProductAlreadyDiscontinuedError` e `InvalidStateTransitionException` se añaden automáticamente.

**Sin `errorCode`:** comportamiento legacy (la excepción genérica se propaga).

---

## 14. `errors[].kind` + `errors[].triggeredBy` — errores de infraestructura declarables (E5)

Permite declarar errores que no son violaciones de dominio sino fallas técnicas, y mapearlos automáticamente a una excepción JVM concreta:

```yaml
errors:
  - code: CATALOG_DATABASE_UNAVAILABLE
    httpStatus: 503
    kind: infrastructure
    triggeredBy: org.springframework.dao.DataAccessResourceFailureException
    chainable: true
    usedFor: manual
    description: La base de datos del BC catalog no está accesible.
```

**Genera** en `HandlerExceptions`:

```java
import org.springframework.dao.DataAccessResourceFailureException;
import com.example.catalog.domain.errors.CatalogDatabaseUnavailableError;

@ExceptionHandler(DataAccessResourceFailureException.class)
public ResponseEntity<ErrorResponse> onDataAccessResourceFailureException(
        DataAccessResourceFailureException ex) {
    log.warn("Infrastructure failure mapped to CATALOG_DATABASE_UNAVAILABLE", ex);
    CatalogDatabaseUnavailableError domainEx = new CatalogDatabaseUnavailableError();
    return ResponseEntity.status(domainEx.getHttpStatus())
        .body(new ErrorResponse(
            domainEx.getHttpStatus(),
            "Service Unavailable",
            domainEx.getCode(),
            domainEx.getMessage(),
            domainEx.getDetails()
        ));
}
```

**Validación:**

- `triggeredBy` solo permitido cuando `kind: infrastructure`.
- Mapeos ambiguos (mismo `triggeredBy` → dos errores diferentes en BCs distintos) fallan con mensaje claro en build-time.
- Acepta FQN (recomendado) o nombre simple.

**Recomendación:** combinar con `usedFor: manual` (el throw no aparece en código de aplicación, lo lanza el advice) y `chainable: true` (preserva la causa técnica).

---

## 15. Catálogo inverso `docs/errors/{bc}-errors-catalog.md` (E7)

Para cada BC, el generador produce un catálogo de errores con la matriz inversa `errorCode → sitios de uso`:

```
docs/errors/
  catalog-errors-catalog.md
  inventory-errors-catalog.md
  ...
```

**Estructura del archivo generado:**

1. **Header** con fecha, conteo total, conteo de huérfanos.
2. **Summary table** (Code, HTTP, Kind, Java Class, # References).
3. **Sección por error** con:
   - HTTP status, kind, Java class FQN
   - `usedFor`, `chainable`, `triggeredBy`, `messageTemplate`, `args`
   - `description`
   - **Referenced by** — lista agrupada por tipo:
     - `domainRule` (con id del rule + agregado)
     - `useCase.notFoundError` (con id del UC)
     - `useCase.lookup` (con id del UC + param)
     - `useCase.fkValidation` (con id del UC + campo)
     - `useCase.validation` (con id del UC + id del validation)
   - O nota explícita si es huérfano / `manual` / `infrastructure`.
4. **Warning consolidado** al final si hay huérfanos sin justificación.

**Ejemplo de entrada en el catálogo:**

```markdown
### CATEGORY_NAME_ALREADY_EXISTS

- **HTTP:** 409
- **Kind:** business
- **Java class:** `com.example.catalog.domain.errors.CategoryNameAlreadyExistsError`
- **chainable:** false
- **messageTemplate:** `Category with name '{name}' already exists`
- **args:** `name: String`
- **description:** A category with that name already exists in the catalog.

**Referenced by:**
- `domainRule[CAT-RULE-001]` (uniqueness on `Category.name`)
- `useCase[UC-CAT-001 CreateCategory]` — via constraint
- `useCase[UC-CAT-003 UpdateCategory]` — via constraint
```

No requiere ningún cambio en el YAML — el catálogo se regenera automáticamente en cada build después de la fase de application.

---

## Compatibilidad

Todas las extensiones listadas son **opcionales**. Un `{bc}.yaml` que no use ninguna de las claves nuevas:

- Genera **byte-idéntico** el código que generaba antes de las fases.
- No emite warnings nuevos (el de huérfanos sólo aparece si hay errores declarados sin uso, que ya era un problema latente).
- El `HandlerExceptions` mantiene exactamente los mismos handlers cuando no hay `triggeredBy` ni `constraintName` declarados en ningún BC.

## Pendientes (deferred, no críticos)

- **E2 final:** regeneración de `ErrorResponse.java` desde el schema OpenAPI del BC + opt-in `dsl-springboot.json#errorFormat: problemDetails` (RFC 7807).
- **E13:** lectura de mensajes desde `messages_*.properties` cuando `dsl-springboot.json#i18n: true`.

Cf. [analisis/errors-analisis.md §6](../analisis/errors-analisis.md) para el detalle completo de archivos modificados por fase.
