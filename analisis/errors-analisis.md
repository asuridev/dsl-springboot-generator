# Análisis profundo de la sección `errors` — robustez del generador

> Diseño analizado: `C:/Users/antonio.suarez/Desktop/test-dsl/arch/`
> Código generado: `C:/Users/antonio.suarez/Desktop/test-dsl/`
> Generador: [src/generators/application-generator.js](../src/generators/application-generator.js) (`buildErrorMap`, `generateDomainErrors`, `normalizeNotFoundErrors`)
> Reader: [src/utils/bc-yaml-reader.js](../src/utils/bc-yaml-reader.js)
> Templates: [templates/domain/DomainError.java.ejs](../templates/domain/DomainError.java.ejs)
> Runtime compartido: [shared/domain/customExceptions/*](../templates/shared/) y [shared/infrastructure/handlerException/HandlerExceptions.java](../templates/shared/)

---

## ✅ Estado actual (post-remediación, abril 2026)

Este documento fue el insumo para 4 fases de remediación. **13 de 15 gaps están cerrados**; los 2 restantes son deferred no críticos.

| Fase | Gaps cerrados | Estado |
|---|---|---|
| **Fase 1** — Higiene base | E10, E11, E12, E14, E15 | ✅ DONE |
| **Fase 2** — Mensaje y contrato | E3, E4, parcial E2 | ✅ DONE |
| **Fase 3** — Emisión declarativa de throws | E1 (a/b/c/d), E6, E8, E9 | ✅ DONE |
| **Fase 4** — Infraestructura + catálogo inverso | E5, E7 | ✅ DONE |
| **Pendientes (deferred)** | E13 (i18n), final de E2 (`ErrorResponse` desde OpenAPI) | 🟡 |

Cada gap conserva su descripción original; al final de cada uno se ha añadido un bloque **"✅ Implementado"** o **"🟡 Deferred"** que documenta cómo quedó resuelto y en qué archivos.

---

## 1. Qué soporta hoy el generador

### 1.1 Schema de `errors[]` reconocido (post-Fase 4)

| Clave | Tipo | Obligatoria | Procesamiento |
|---|---|---|---|
| `code` | string SCREAMING_SNAKE_CASE | ✅ | unicidad validada; deriva nombre de clase Java |
| `httpStatus` | enum `400,401,402,403,404,408,409,412,415,422,423,429,503,504` | ❌ (default → 422 vía `BusinessException`) | mapea a superclase `HTTP_TO_EXCEPTION` o a `DomainException` directo para statuses extendidos |
| `description` | string | ❌ | emitida como Javadoc en la clase Java generada (E11) |
| `message` | string | ❌ | declarada en whitelist; usada como mensaje legacy si no hay `messageTemplate` |
| `title` | string | ❌ | declarada en whitelist (reservada) |
| `errorType` | PascalCase identifier | ❌ | override del nombre derivado de `code` (E10) |
| `chainable` | boolean | ❌ | si `true`, genera ctor `(Throwable cause)` adicional (E14) |
| `usedFor` | enum `auto\|manual` | ❌ | suprime el warning de huérfano cuando es `manual` (E15) |
| `messageTemplate` | string con `{name}` placeholders | ❌ | precompilado a expresión Java con `String.valueOf()` (E3) |
| `args[]` | lista de `{name, type}` | ❌ | genera ctor parametrizado tipado, requiere `messageTemplate` (E3) |
| `kind` | enum `business\|infrastructure` | ❌ | clasifica el error; `infrastructure` requiere `triggeredBy` (E5) |
| `triggeredBy` | Java class name (FQN o simple) | ❌ | excepción JVM que `HandlerExceptions` traduce al error de dominio (E5) |

Mapping HTTP → excepción base (en [application-generator.js](../src/generators/application-generator.js)):

| `httpStatus` | Superclase Java |
|---|---|
| 400 | `BadRequestException` |
| 401 | `UnauthorizedException` |
| 403 | `ForbiddenException` |
| 404 | `NotFoundException` |
| 409 | `ConflictException` |
| 422 | `BusinessException` |
| 402, 408, 412, 415, 423, 429, 503, 504 | `DomainException` (status dinámico vía `@ExceptionHandler(DomainException.class)`) |

### 1.2 Pipeline de generación

| Fase | Archivo | Salida |
|---|---|---|
| 1. Validación | `validateBcDoc` en `bc-yaml-reader.js` | unicidad de `code`; whitelist de keys; `httpStatus` enumerado; `args` tipados; `kind`/`triggeredBy` consistentes |
| 2. Cross-check referencial | `bc-yaml-reader.js` | `notFoundError`, `lookups[].errorCode`, `fkValidations[].error`, `validations[].errorCode`, `domainRules[].errorCode` deben existir en `errors[]`; warning de errores huérfanos (E15) |
| 3. Build error map | `buildErrorMap(errors)` | `{ [code]: { errorType, httpStatus, baseException, args, messageTemplate, chainable, kind, triggeredBy } }` |
| 4. Generación dominio | `generateDomainErrors` | `domain/errors/{ErrorType}.java` (con Javadoc, ctores estructurados, `(Throwable)` cuando `chainable: true`, ctor parametrizado cuando hay `args`) |
| 5. Inyección en handlers | `buildCommandHandlerBody` / `buildQueryHandlerBody` | `orElseThrow(NotFoundError::new)` en lookup primario, throws emitidos para `uniqueness`/`statePrecondition`/`deleteGuard`/`crossAggregateConstraint`/`validations` con hints, TODOs enriquecidos con clase Java + import nominado cuando faltan hints |
| 6. Inyección en aggregates | `aggregate-generator.js` `computeMethodBody` | `transitionTo(...)` envuelto en try/catch que traduce `InvalidStateTransitionException` al error declarado en `terminalState.errorCode` (E1.d) |
| 7. JPA constraints | `jpa-entity-generator.js` | `@Table(uniqueConstraints = @UniqueConstraint(name = ..., columnNames = ...))` cuando `domainRules[].constraintName` está declarado (E6) |
| 8. Runtime compartido | `base-project-generator.js` | `customExceptions/*.java` + `HandlerExceptions.java` (con `CONSTRAINT_TO_ERROR` map para race-conditions de DB y `@ExceptionHandler` por cada `triggeredBy`) + `ErrorResponse` record con campo `code` |
| 9. Errors catalog | `errors-catalog-generator.js` | `docs/errors/{bc}-errors-catalog.md` con summary + matriz inversa de referencias + warning de huérfanos (E7) |

### 1.3 Verificación contra `test-dsl/catalog`

| Capacidad | Evidencia |
|---|---|
| Una clase Java por error declarado | 12 errores YAML → 12 archivos `domain/errors/*Error.java` |
| Superclase deriva de `httpStatus` | `CategoryNotFoundError extends NotFoundException` (404), `CategoryNameAlreadyExistsError extends ConflictException` (409), `ProductNotActivatableError extends BusinessException` (422) |
| Trazabilidad obligatoria | `// derived_from: errors[CATEGORY_NOT_FOUND]` en cada clase |
| `notFoundError` se usa en repos | `ActivateCategoryCommandHandler.findById(...).orElseThrow(CategoryNotFoundError::new)` |
| `fkValidations[].error` se usa en cross-aggregate | (no presente en catalog, pero el pipeline está implementado en líneas 842-859) |
| `@RestControllerAdvice` traduce excepción → HTTP | `HandlerExceptions.onNotFoundException` retorna 404, etc. |

---

## 2. Qué **no** soporta — gaps detectados

### Severidad 🔴 — bloquean el funcionamiento end-to-end

#### Gap E1 — Errores declarados pero nunca lanzados (huérfanos)

**Hecho:** En `test-dsl/catalog`, **9 de 12** errores generados nunca aparecen en un `throw` ni en un `orElseThrow` del código generado. Sólo los 3 `*NotFoundError` tienen un sitio de uso porque se enganchan vía `notFoundError` + `findById`.

| Error declarado | Sitio de uso en código generado |
|---|---|
| `CATEGORY_NOT_FOUND` | ✅ `findById().orElseThrow(...)` (5 handlers) |
| `PRODUCT_NOT_FOUND` | ✅ `findById().orElseThrow(...)` (5 handlers) |
| `PRODUCT_IMAGE_NOT_FOUND` | ❌ huérfano |
| `CATEGORY_NAME_ALREADY_EXISTS` | ❌ huérfano (referenciado por `domainRule` `uniqueness` pero no emitido) |
| `CATEGORY_SLUG_ALREADY_EXISTS` | ❌ huérfano |
| `CATEGORY_HAS_ACTIVE_PRODUCTS` | ❌ huérfano (`deleteGuard` no emite el throw) |
| `PRODUCT_SKU_ALREADY_EXISTS` | ❌ huérfano |
| `PRODUCT_SLUG_ALREADY_EXISTS` | ❌ huérfano |
| `PRODUCT_NOT_ACTIVATABLE` | ❌ huérfano (`statePrecondition`) |
| `PRODUCT_CANNOT_BE_DELETED` | ❌ huérfano (`deleteGuard`) |
| `PRODUCT_ALREADY_DISCONTINUED` | ❌ huérfano (terminal state — sólo se lanza `InvalidStateTransitionException` genérica, sin código de error) |
| `PRODUCT_CATEGORY_NOT_ACTIVE` | ❌ huérfano (`crossAggregateConstraint`) |

**Causa raíz:** los `domainRules[]` de tipo `uniqueness`, `statePrecondition`, `deleteGuard` y `crossAggregateConstraint` declaran `errorCode` pero el generador **no traduce el errorCode al throw** en el sitio del guard. Según [docs/aggregates-new-features.md §4.5](../docs/aggregates-new-features.md), el `deleteGuard` _debería_ emitir un check `if (count > 0) throw new CategoryHasActiveProductsError()` pero ese cuerpo en `DeleteCategoryCommandHandler` actualmente es `throw new UnsupportedOperationException("Not implemented yet")` (scaffold). El `crossAggregateConstraint` documentado en §4.6 igualmente no se materializa.

**Impacto:** un humano lee `errorCode: PRODUCT_CATEGORY_NOT_ACTIVE` en el YAML y asume que el generador cableó la lógica; en runtime nunca se lanza ese error y el contrato 422 declarado en OpenAPI nunca se cumple. Además, los 9 archivos `*Error.java` huérfanos son código muerto y romperán cualquier `findUsages` automático.

**Propuesta declarativa (mínima):**

a) Para `domainRules` de tipo `uniqueness`, generar dentro del CommandHandler (cuando `implementation: scaffold` lo permite o `implementation: full`):

```java
// derived_from: domainRule[CAT-RULE-001] uniqueness
if (categoryRepository.findByName(command.name()).isPresent()) {
    throw new CategoryNameAlreadyExistsError();
}
```

Requisito: el repo expone `findBy{Field}` (ya garantizado por la propia regla `uniqueness` — [docs/repositories-new-features.md](../docs/repositories-new-features.md)).

b) Para `deleteGuard` con `targetAggregate` + `targetRepositoryMethod` declarados (ya existe `CategoryHasActiveProducts` con esos hints), emitir el guard end-to-end. Para los que no los tengan, el TODO actual es aceptable pero debe **mencionar el errorCode** y la clase Java a usar (ahora no lo hace).

c) Para `statePrecondition` y `crossAggregateConstraint`, declarar nuevos hints opcionales que permitan la generación determinista; cuando falten, emitir `// TODO domainRule(<id>): when <expression>, throw new <ErrorClass>()` _con el nombre exacto de la clase Java derivada_, para que la Fase 3 humana solo copie/pegue.

d) Para `terminalState` reemplazar la `InvalidStateTransitionException` genérica por la clase específica `Product.transitionTo(...)` cuando el rule declara `errorCode: PRODUCT_ALREADY_DISCONTINUED` (hoy se ignora silenciosamente — el throw es genérico).

**✅ Implementado (Fase 3):**

- (a) `domainRules[].uniqueness` con hint `field` → emite `findBy{Field}().isPresent() → throw` (create) y `.ifPresent(other → if id != aggVar.getId() throw)` (update). Sin hint: TODO enriquecido nominando la clase Java + import. Files: `src/utils/domain-rule-mapper.js` (`mapUniqueness`), `src/generators/application-generator.js`, `templates/application/UcCommandHandler.java.ejs`.
- (b) `deleteGuard` y `crossAggregateConstraint`: con hints (`targetAggregate` + `targetRepositoryMethod`) emiten throw real desde antes; sin hints emiten TODO enriquecido con la clase Java + ejemplo de throw para copy/paste.
- (c) `statePrecondition`: TODO enriquecido nominando la clase Java + import. (No se autoemite porque no hay sublenguaje de expresiones).
- (d) `terminalState` con `errorCode`: `aggregate-generator.computeMethodBody` envuelve `this.status = this.status.transitionTo(...)` en try/catch que traduce `InvalidStateTransitionException` a la error class declarada (`throw new ProductAlreadyDiscontinuedError();`). Imports añadidos automáticamente. Sin `errorCode`: comportamiento legacy intacto.

---

#### Gap E2 — Contrato `ErrorResponse` divergente entre OpenAPI y runtime

**Hecho:** El OpenAPI público (`catalog-open-api.yaml#/components/schemas/ErrorResponse`) declara:

```yaml
ErrorResponse:
  required: [code, message]
  properties:
    code: { type: string, example: PRODUCT_NOT_FOUND }
    message: { type: string }
    details: { type: array, items: { properties: { field: string, issue: string } } }
```

El record runtime generado ([shared/domain/errorMessage/ErrorResponse.java](file:///C:/Users/antonio.suarez/Desktop/test-dsl/src/main/java/co/com/asuarez/shared/domain/errorMessage/ErrorResponse.java)) es:

```java
record ErrorResponse(Instant timestamp, int status, String error, String message, List<String> details)
```

**Divergencias:**

1. ❌ El campo `code` (machine-readable, requerido por OpenAPI) **no existe en runtime**.
2. ❌ El runtime envía `status: int` y `error: "Not Found"`, ninguno declarado en OpenAPI.
3. ❌ El runtime envía `timestamp: Instant`, no declarado en OpenAPI.
4. ❌ `details` runtime es `List<String>`; OpenAPI lo declara como `List<{field, issue}>`.
5. ❌ El `message` que llega al cliente es el constructor argument del error (`super("CATEGORY_NOT_FOUND")`), o sea el código en mayúsculas — no la `description` declarada en `errors[]`.

**Impacto:** un cliente que consuma el OpenAPI no puede deserializar la respuesta sin un mapeo manual. La metadata `description`/`message` declarada en `errors[]` en el YAML nunca llega al cliente.

**Propuesta declarativa:**

a) Generar `ErrorResponse` runtime alineado con el contrato OpenAPI (preferir RFC 7807 `application/problem+json` si el `dsl-springboot.json` declara `errorFormat: problemDetails`, o el formato custom OpenAPI declarado).

b) Pasar `errorCode` como primer argumento al constructor del error de dominio y exponer `getCode()` en `DomainException`. El advice debe poblar `code` y `message` con esos valores (no el código en `message`).

c) Generar un `ErrorCatalogConfiguration` que cargue el mapa `code → description` desde `errors[]` para que el advice rellene `message` con la descripción humana y mantener `code` como machine-readable.

d) Si se declara una clave nueva `errors[].messageTemplate: "Category {name} already exists"`, permitir parametrización con argumentos del constructor del error (hoy las clases son `()` sin args).

**✅/🟡 Parcialmente implementado (Fase 2):**

- ✅ `ErrorResponse` runtime ahora incluye campo `code` opcional (5-arg ctor `(status, reason, code, message, details)`); ctores legacy preservados.
- ✅ `DomainException` estructurado con getters `getCode()`, `getHttpStatus()`, `getArgs()`, `getDetails()`. Subclases (Business/NotFound/Conflict/BadRequest/Unauthorized/Forbidden) forwardean ctores estructurados.
- ✅ `HandlerExceptions` ahora rellena `code` desde `domainEx.getCode()` y `details` desde `getDetails()` en cada handler. Genérico `@ExceptionHandler(DomainException.class)` retorna `ResponseEntity` con `httpStatus` dinámico.
- ✅ (d) `errors[].messageTemplate` + `errors[].args` implementados; placeholders `{name}` precompilados a expresión Java con `String.valueOf()`.
- 🟡 **Deferred**: regenerar `ErrorResponse.java` desde `*-open-api.yaml#/components/schemas/ErrorResponse` (hoy template fijo). El gap no bloquea: cliente puede deserializar via `code`/`message`/`details`. Requiere lectura del schema OpenAPI por BC.
- 🟡 **Deferred**: opt-in `dsl-springboot.json#errorFormat: openApi|problemDetails` (RFC 7807).

---

#### Gap E3 — Errores sin mensaje parametrizable

**Hecho:** Toda subclase generada tiene un único constructor sin args:

```java
public CategoryNotFoundError() { super("CATEGORY_NOT_FOUND"); }
```

No es posible decir "category abc-123 not found" — sólo "CATEGORY_NOT_FOUND". Las claves `message` y `title` están en la whitelist del reader pero el template las ignora. Las VOs y aggregates lanzan `IllegalArgumentException` con mensajes ricos; los errores de dominio declarativos no.

**Propuesta declarativa:**

```yaml
errors:
  - code: CATEGORY_NOT_FOUND
    httpStatus: 404
    title: Category not found
    messageTemplate: "Category {id} not found"
    args:
      - { name: id, type: Uuid }
```

→ genera un constructor adicional `CategoryNotFoundError(UUID id)` con interpolación segura, y `findById(...).orElseThrow(() -> new CategoryNotFoundError(command.id()))`.

**✅ Implementado (Fase 2):**

Reader valida `messageTemplate` (string) + `args[]` (lista de `{name, type}` con `name` camelCase Java identifier, `type` Java type pattern, sin duplicados, requiere `messageTemplate` cuando `args` es no vacío). `application-generator.compileMessageTemplate()` precompila los placeholders a expresión Java. Template `DomainError.java.ejs` genera ctores parametrizados tipados. PoC verificada: `PRODUCT_RATE_LIMITED` con args `(UUID id, int limit)` y messageTemplate `"Product {id} rate limited at {limit}"` genera `ProductRateLimitedError(UUID id, int limit)` + `(Throwable)` ctor (cuando `chainable: true`) + Javadoc.

---

### Severidad 🟠 — limitan escenarios reales pero no rompen build

#### Gap E4 — `httpStatus` enum cerrado pierde casos comunes

**Hecho:** El reader rechaza cualquier `httpStatus` distinto de `400, 401, 403, 404, 409, 422`. Faltan códigos legítimos de uso frecuente:

| Código | Uso típico no cubierto |
|---|---|
| `402` | Payment required (BC `payments`) |
| `423` | Locked (recursos en bloqueo optimista) |
| `429` | Too many requests (rate-limit / idempotency replay) |
| `408` | Request timeout |
| `412` | Precondition failed (`If-Match` con ETag) |
| `415` | Unsupported media type (multipart) |
| `503` | Service unavailable (downstream caído) |
| `504` | Gateway timeout (resilience) |

Sin estos, el `OutboundHttpAdapter` y el `consumerIdempotency` (que pueden necesitar 429 o 412) no pueden expresar su contrato vía `errors[]`.

**Propuesta:** ampliar la whitelist y añadir las superclases correspondientes (`PaymentRequiredException`, `TooManyRequestsException`, `PreconditionFailedException`, `ServiceUnavailableException`, `GatewayTimeoutException`).

**✅ Implementado (Fase 2):**

`ALLOWED_HTTP_STATUSES` ampliado a `{400, 401, 402, 403, 404, 408, 409, 412, 415, 422, 423, 429, 503, 504}`. En lugar de crear superclases dedicadas para cada status nuevo, los statuses extendidos extienden directamente `DomainException` y son capturados por el `@ExceptionHandler(DomainException.class)` genérico que lee el `httpStatus` desde la metadata estructurada. Esto evita la explosión de superclases y mantiene el comportamiento dinámico.

---

#### Gap E5 — Errores de infraestructura no declarables

**Hecho:** Los errores que no son violaciones de dominio sino fallas técnicas (`OUTBOX_PUBLISH_FAILED`, `KAFKA_BROKER_DOWN`, `IDEMPOTENCY_REPLAY`, `OPTIMISTIC_LOCK_CONFLICT`) no tienen forma de declararse. El runtime lanza `DataIntegrityViolationException` u otras excepciones Spring que el advice traduce con un `message` estático ("Data integrity violation — a constraint was not satisfied"), perdiendo el `code` machine-readable.

**Propuesta declarativa:**

```yaml
errors:
  - code: OPTIMISTIC_LOCK_CONFLICT
    httpStatus: 409
    kind: infrastructure          # nuevo: 'business' (default) | 'infrastructure'
    triggeredBy: OptimisticLockingFailureException
```

→ El advice añade `@ExceptionHandler(OptimisticLockingFailureException.class)` que retorna el `ErrorResponse` con `code: OPTIMISTIC_LOCK_CONFLICT`. Mismo patrón para `DataIntegrityViolationException` con `code: DATA_INTEGRITY_VIOLATION` declarado.

**✅ Implementado (Fase 4):**

Reader whitelist: `kind: business|infrastructure` + `triggeredBy: <ExceptionClassName>` (FQN o simple). Validación: `triggeredBy` solo permitido cuando `kind: infrastructure`. `base-project-generator.buildInfrastructureErrorMap` colecta cross-BC todos los pares `(triggeredBy → ErrorClass)`; mapeos ambiguos (mismo Exception → dos errores diferentes) fallan con mensaje claro. `HandlerExceptions.java.ejs` añade FQN imports + un `@ExceptionHandler` por cada Exception, traduciendo a `new <ErrorClass>()` con `log.warn(ex)` y preservando `code`/`httpStatus`/`details`. Sin `triggeredBy`: comportamiento legacy. PoC verificada con `CATALOG_DATABASE_UNAVAILABLE` (httpStatus 503, kind infrastructure, triggeredBy `org.springframework.dao.DataAccessResourceFailureException`).

---

#### Gap E6 — `domain_rule.uniqueness` no garantiza `@Column(unique = true)` + retry

**Hecho:** Según [docs/aggregates-new-features.md §4.1](../docs/aggregates-new-features.md), `uniqueness` debería emitir el constraint en JPA y `findBy{Field}` en repo. Eso ocurre. Pero el flujo de doble-check (consulta → insert) no es atómico: en alta concurrencia, dos requests simultáneas pueden pasar el `findByName` y la BD lanza `DataIntegrityViolationException`, que el advice traduce como 409 genérico — perdiendo el `code: CATEGORY_NAME_ALREADY_EXISTS`.

**Propuesta:** declarar la asociación `errorCode ↔ constraint name` y manejar el `DataIntegrityViolationException`:

```yaml
domainRules:
  - id: CAT-RULE-001
    type: uniqueness
    errorCode: CATEGORY_NAME_ALREADY_EXISTS
    constraintName: uk_category_name   # nuevo, opcional
```

→ JPA emite `@Column(name = "name", unique = true)` + `@Table(uniqueConstraints = @UniqueConstraint(name = "uk_category_name", columnNames = "name"))`. El advice global atrapa `DataIntegrityViolationException`, extrae el constraint name, y traduce a `CategoryNameAlreadyExistsError` con su código exacto.

**✅ Implementado (Fase 3):**

Reader: `constraintName` añadido a `ALLOWED_RULE_KEYS`; validación restrictiva (sólo permitido en `type: uniqueness`, requiere `field`, formato snake_case `^[a-z][a-z0-9_]*$`). `jpa-entity-generator` colecta `uniqueConstraints` en el contexto del template. `JpaEntity.java.ejs` renderiza `@Table(uniqueConstraints = { @UniqueConstraint(name=..., columnNames="...") })`. `base-project-generator.buildConstraintErrorMap` colecta cross-BC los pares `(constraintName → ErrorClass)`. `HandlerExceptions.java.ejs` añade `Map<String, Supplier<? extends DomainException>> CONSTRAINT_TO_ERROR` y un `@ExceptionHandler(DataIntegrityViolationException)` que extrae el constraint name desde `org.hibernate.exception.ConstraintViolationException` (case-insensitive) y traduce a la subclase Java declarada, preservando `code`/`httpStatus`/`details`. Sin entries: fallback al 409 genérico (legacy).

---

#### Gap E7 — Sin trazabilidad inversa `errorCode → domainRule | useCase | endpoint`

**Hecho:** Las clases generadas tienen `// derived_from: errors[<CODE>]` (cumple AGENTS.md §3 hacia abajo). Pero no se documenta **dónde** se debería lanzar ese error. Para un humano de Fase 3 implementando el `// TODO`, no hay pista directa.

**Propuesta:** generar un `errors-catalog.md` (o Javadoc enriquecido) por BC con la matriz inversa:

```
CATEGORY_NAME_ALREADY_EXISTS (409)
  ├── domainRule: CAT-RULE-001 (uniqueness on Category.name)
  ├── thrown by: CreateCategoryCommandHandler, UpdateCategoryCommandHandler
  └── exposed as: POST /categories (409), PATCH /categories/{id} (409)
```

Coste cero en runtime y elimina la pregunta más común durante Fase 3.

**✅ Implementado (Fase 4):**

Nuevo generador `src/generators/errors-catalog-generator.js` + template `templates/docs/ErrorsCatalog.md.ejs`. Por cada BC produce `docs/errors/{bc}-errors-catalog.md` con: (1) summary table con HTTP/kind/Java class/conteo de referencias, (2) sección por error con HTTP, kind, Java class FQN, `usedFor`, `chainable`, `triggeredBy`, `messageTemplate`, `args`, `description`, (3) matriz inversa de referencias agrupada por tipo (`domainRule`, `useCase.notFoundError`, `useCase.lookup`, `useCase.fkValidation`, `useCase.validation`), (4) warning consolidado de huérfanos (excluye `usedFor: manual` y `kind: infrastructure`). Wired en `build.js` después del application layer. PoC catalog: 12 errores, 11 referenciados, 1 huérfano detectado correctamente.

---

#### Gap E8 — `notFoundError` solo soporta el id principal del aggregate

**Hecho:** La función `normalizeNotFoundErrors` retorna una lista, pero los handlers solo consumen `notFoundErrors[0]` (líneas 829, 1024, 1127 de `application-generator.js`). No hay forma de declarar "este UC tiene 2 lookups: el del Category y el del Product".

```yaml
useCases:
  - id: UC-PRD-007
    notFoundError: [PRODUCT_NOT_FOUND, PRODUCT_IMAGE_NOT_FOUND]   # solo se usa el primero
```

**Propuesta:** mover la asociación `errorCode ↔ lookup` a `fkValidations[]` (que ya soporta varios) o a una nueva clave `lookups[]`:

```yaml
lookups:
  - param: id
    aggregate: Product
    error: PRODUCT_NOT_FOUND
  - param: imageId
    nestedIn: Product.images
    error: PRODUCT_IMAGE_NOT_FOUND
```

Esto rescata `PRODUCT_IMAGE_NOT_FOUND` del estado huérfano (Gap E1).

**✅ Implementado (Fase 3):**

Nuevo schema `useCases[].lookups[]` añadido al reader: `ALLOWED_UC_LOOKUP_KEYS = {param, aggregate, errorCode, nestedIn, description}`. Validación: mutuamente exclusivo con `notFoundError` (declarar ambos falla); sin `param` duplicados; `nestedIn` debe matchear regex `^[A-Z]\w*\.[a-z]\w*$`; cada `errorCode` validado cross-reference con `errors[]`. En `application-generator`: `resolvePrimaryNotFoundError(uc)` extrae el lookup primario (conduce el `findById.orElseThrow`), `additionalLookups(uc)` emite TODOs enriquecidos con la `<ErrorClass>` Java exacta + import añadido al handler. Aplica a command y query handlers. `notFoundError` (legacy single-entry) preservado por backward-compat.

---

#### Gap E9 — `validations[].errorCode` se valida pero no se emite como throw

**Hecho:** El reader valida que `useCases[].validations[].errorCode` exista en `errors[]` (línea 821). El generador, al construir el handler, sólo emite un `// TODO` (líneas 1614-1615, 1928-1929, 2114-2115). El `errorCode` no llega al TODO de forma visible.

```java
// uc-validations actual:
// TODO useCase(<id>): cross-field validation: <expression>
```

**Propuesta:** que el TODO incluya el throw exacto a copiar:

```java
// derived_from: validations[V-001]
if (!(command.startDate().isBefore(command.endDate()))) {
    throw new InvalidDateRangeError();   // errors[INVALID_DATE_RANGE]
}
```

Si la `expression` es un Java boolean literal (ya soportado en el filter de `trigger.event`), generarlo directo; si no, dejar TODO _con el throw nominado_.

**✅ Implementado (Fase 3):**

Nuevo helper `looksLikeJavaBoolean(expression)` en `application-generator.js` (detecta `==`, `!=`, `<`, `>`, `&&`, `||`, `!`, `.isPresent()`, `.isEmpty()`, etc.). Función `enrichValidations(uc)` recorre cada `validations[]`: si la expresión parece Java boolean → emite `if (!(<expression>)) throw new <ErrorClass>();` con `// derived_from: validations[<id>]` + import. Si no → emite TODO enriquecido con la clase Java + ejemplo de throw para copy/paste. Imports auto-resueltos via `validationErrorImports`.

---

### Severidad 🟡 — calidad / DX

#### Gap E10 — Naming derivation rígida y sin override

`deriveErrorType('PRODUCT_NOT_FOUND')` siempre produce `ProductNotFoundError`. No se respeta `errorType: ProductNotFoundException` aunque la línea 37 de `buildErrorMap` lo lee — el reader no lo permite (no está en la whitelist `ALLOWED_ERROR_KEYS`). Inconsistencia interna que conviene cerrar: o se permite override de naming en la whitelist o se elimina del código.

**✅ Implementado (Fase 1):** `errorType` añadido a `ALLOWED_ERROR_KEYS` (debe ser PascalCase identifier `^[A-Z][A-Za-z0-9_]*$`). `buildErrorMap` ahora consume el override consistentemente.

#### Gap E11 — `description` declarada pero invisible a la Fase 3

La `description` rica del YAML ("The product cannot be activated. It must have a name, a valid price greater than zero…") nunca aparece en el Javadoc de `ProductNotActivatableError.java`. Una sola línea EJS lo solucionaría:

```ejs
/**
 * <%- description -%>
 */
public class <%= errorType %> extends <%= baseException %> {
```

**✅ Implementado (Fase 1):** `templates/domain/DomainError.java.ejs` ahora emite la `description` como Javadoc cuando está declarada. Ausente → sin Javadoc (sin ruido).

#### Gap E12 — `BusinessException` y `NotFoundException` permiten constructor sin mensaje

Las superclases compartidas exponen un constructor `()` vacío:

```java
public NotFoundException() {}
public NotFoundException(String message) { super(message); }
```

Esto invita a `throw new BusinessException()` con mensaje nulo, que el advice expone como "A business rule was violated" (genérico). Conviene marcar `protected` el ctor sin args para forzar a subclases o eliminarlo.

**✅ Implementado (Fase 1):** ctores sin args en `BusinessException`, `NotFoundException`, `ConflictException`, `BadRequestException`, `UnauthorizedException`, `ForbiddenException` marcados como `protected`. Forzando subclases nombradas, los `throw new BusinessException()` adámicos quedan prohibidos en compile-time fuera del paquete.

#### Gap E13 — Ausencia de `i18n` / mensajes localizados

El `messageTemplate` propuesto en E3 podría leerse de un `messages_en.properties` / `messages_es.properties` cuando `dsl-springboot.json` declare `i18n: true`. Hoy no es posible declarar mensajes traducidos.

**🟡 Deferred:** No implementado. La parametrización de mensaje (E3) ya cubre el caso más común; i18n queda como mejora futura cuando exista demanda real. Ruta: extender `compileMessageTemplate` para leer de `MessageSource` cuando el config flag esté activo.

#### Gap E14 — Sin `cause` propagada

El constructor único `super(code)` impide encadenar la excepción técnica original (`new OutboxPublishFailedError(e)`). Útil para diagnóstico de errores de infraestructura (Gap E5).

**✅ Implementado (Fase 1):** nueva clave `errors[].chainable: true|false` (default false). Cuando `true`, `DomainError.java.ejs` emite ctor adicional `(Throwable cause)` que delega `super(code, cause)`. Las superclases compartidas añadieron el ctor `(String message, Throwable cause)` correspondiente.

#### Gap E15 — No se valida que cada `errors[]` tenga al menos un `derivedFrom` real

El reader exige que cada `domainRule.errorCode` exista en `errors[]`, pero no la inversa: no avisa cuando un `error` declarado no es referenciado por ninguna `domainRule`, `notFoundError`, `fkValidation` o `validations`. Esto permite que sobrevivan los huérfanos del Gap E1 sin warning.

**Propuesta:** advertencia (no error) `WARN: error "<CODE>" is declared but never referenced` durante el reader, salvo que el error declare `usedFor: manual` para suprimir el warning.

**✅ Implementado (Fase 1):** nueva clave `errors[].usedFor: auto|manual` (default `auto`). Reader analiza referencias cruzadas y emite `WARN: error "<CODE>" is declared but never referenced` cuando el error es `auto` y no aparece en ninguna `domainRule.errorCode`, `notFoundError`, `lookups[].errorCode`, `fkValidations[].error`, ni `validations[].errorCode`. Errores `usedFor: manual` o `kind: infrastructure` se excluyen del warning. La matriz inversa (Gap E7) consolida la auditoría.

---

## 3. Tabla resumen de gaps

| ID | Severidad | Tema | Schema nuevo | Esfuerzo | Estado |
|---|---|---|---|---|---|
| E1 | 🔴 | Errores huérfanos / no se traduce `errorCode` a throw | (ninguno; usar hints existentes) | alto | ✅ Fase 3 |
| E2 | 🔴 | Divergencia `ErrorResponse` runtime vs OpenAPI | `dsl-springboot.json#errorFormat`, `errors[].args` | medio | ✅/🟡 parcial Fase 2 |
| E3 | 🔴 | Mensaje no parametrizable | `errors[].messageTemplate`, `errors[].args` | bajo | ✅ Fase 2 |
| E4 | 🟠 | `httpStatus` enum demasiado cerrado | (ampliar whitelist) | bajo | ✅ Fase 2 |
| E5 | 🟠 | Errores de infraestructura no declarables | `errors[].kind`, `errors[].triggeredBy` | medio | ✅ Fase 4 |
| E6 | 🟠 | `uniqueness` no maneja race-condition de DB | `domainRules[].constraintName` | bajo | ✅ Fase 3 |
| E7 | 🟠 | Sin matriz inversa `error → sitios de uso` | (ninguno; output adicional) | bajo | ✅ Fase 4 |
| E8 | 🟠 | `notFoundError` no soporta lookups múltiples | `useCases[].lookups[]` | medio | ✅ Fase 3 |
| E9 | 🟠 | `validations[].errorCode` no genera throw | (ninguno; mejora del template) | bajo | ✅ Fase 3 |
| E10 | 🟡 | Naming sin override | `errors[].errorType` (ya leído, exponer) | bajo | ✅ Fase 1 |
| E11 | 🟡 | `description` no llega a Javadoc | (ninguno) | trivial | ✅ Fase 1 |
| E12 | 🟡 | Superclases con ctor sin args | (ninguno) | trivial | ✅ Fase 1 |
| E13 | 🟡 | i18n | `dsl-springboot.json#i18n` | medio | 🟡 deferred |
| E14 | 🟡 | `cause` no propagada | `errors[].chainable` | trivial | ✅ Fase 1 |
| E15 | 🟡 | Sin warning de error huérfano | `errors[].usedFor` | trivial | ✅ Fase 1 |

---

## 4. Plan de remediación sugerido (orden de fases)

**Fase 1 — coherencia base (cierra E11, E12, E14, E15, E10)**: cambios mínimos al template `DomainError.java.ejs`, a las superclases y al reader. Sin schema nuevo. Elimina la mayoría del ruido y el código muerto. — ✅ **DONE**

**Fase 2 — mensaje y contrato (cierra E2, E3, E4, E13)**: introduce `messageTemplate`/`args`, alinea `ErrorResponse` con OpenAPI, amplia `httpStatus`, opcionalmente activa i18n. Es el cambio de mayor impacto en la calidad de la API expuesta. — ✅ **DONE** (E3, E4 completos; E2 estructura runtime alineada; regeneración de `ErrorResponse` desde OpenAPI y E13 i18n quedaron deferred)

**Fase 3 — emisión declarativa de throws (cierra E1, E6, E8, E9)**: hace que las `domainRules` `uniqueness`/`deleteGuard`/`crossAggregateConstraint` y las `validations[]` _realmente_ generen el código que las dispara, no solo el archivo de la excepción. Es la fase con mayor superficie de cambio en `application-generator.js`. — ✅ **DONE**

**Fase 4 — infraestructura y trazabilidad (cierra E5, E7)**: errores técnicos declarables y catálogo inverso `errors-catalog.md`. Beneficia onboarding y operación. — ✅ **DONE**

---

## 5. Criterios de aceptación (para cada fase)

1. El mismo `catalog.yaml` actual debe seguir compilando sin cambios (retrocompatibilidad estricta — coherente con [AGENTS.md §2](../AGENTS.md)).
2. Toda nueva clave del schema debe tener whitelist explícita en `bc-yaml-reader.js` (no sólo "tolerada"), siguiendo el patrón ya establecido por las fases de `useCases`/`aggregates`/`projections`.
3. Para casos donde el YAML no provea hints suficientes, el generador **no infiere**: emite `// TODO error(<code>, <aspect>): <causa>` con el nombre exacto de la clase Java a usar (cf. [AGENTS.md §1](../AGENTS.md)).
4. Cada throw generado debe llevar el comentario `// derived_from: errors[<code>]` o `// derived_from: domainRule[<id>]` para preservar la trazabilidad bidireccional.

---

## 6. Resumen de cambios aplicados

### Fase 1 (✅)

- **Templates:** `templates/domain/DomainError.java.ejs` (Javadoc + ctor `(Throwable)` opcional + override `errorType`).
- **Shared:** `templates/shared/customExceptions/*.ejs` — ctores sin args marcados `protected`; ctor `(String, Throwable)` añadido.
- **Reader:** `src/utils/bc-yaml-reader.js` — `errorType`, `chainable`, `usedFor` añadidos a `ALLOWED_ERROR_KEYS`; warning de huérfanos.
- **Generator:** `src/generators/application-generator.js` — `buildErrorMap` consume override `errorType` y propaga `chainable`.

### Fase 2 (✅)

- **Schema:** `errors[].messageTemplate` + `errors[].args[]` (whitelist en reader).
- **HTTP:** `ALLOWED_HTTP_STATUSES` extendido a 14 códigos (402, 408, 412, 415, 423, 429, 503, 504 añadidos).
- **Runtime:** `DomainException` estructurado (`code`/`httpStatus`/`args`/`details`); subclases forwardean. `ErrorResponse` record con campo `code` (5-arg ctor). `HandlerExceptions` usa metadata estructurada y añade `@ExceptionHandler(DomainException.class)` dinámico.
- **Generator:** `compileMessageTemplate` precompila `{name}` placeholders; ctores parametrizados generados.
- **Deferred:** regeneración de `ErrorResponse` desde OpenAPI; opt-in `errorFormat: problemDetails`; i18n.

### Fase 3 (✅)

- **Reader:** `domainRules[].constraintName`, `useCases[].lookups[]` (con `param`/`aggregate`/`errorCode`/`nestedIn`/`description`).
- **Generators:**
  - `src/utils/domain-rule-mapper.js` — nuevos `mapUniqueness`, `mapStatePrecondition`; TODOs enriquecidos para `deleteGuard`/`crossAggregateConstraint`.
  - `src/generators/application-generator.js` — `looksLikeJavaBoolean`, `enrichValidations`, `validationErrorImports`; `resolvePrimaryNotFoundError`, `additionalLookups`.
  - `src/generators/jpa-entity-generator.js` — `@Table(uniqueConstraints=...)` desde `domainRules`.
  - `src/generators/aggregate-generator.js` — `terminalState.errorCode` envuelve `transitionTo` en try/catch traducido (E1.d).
- **Runtime:** `HandlerExceptions` con `CONSTRAINT_TO_ERROR` map; `extractConstraintName` recorre cause chain.

### Fase 4 (✅)

- **Schema:** `errors[].kind: business|infrastructure`, `errors[].triggeredBy: <ExceptionFqn>`.
- **Generator:** `src/generators/base-project-generator.js` — `buildInfrastructureErrorMap` (cross-BC, detecta ambigüedades); inyectado al render de `HandlerExceptions`.
- **Runtime:** `HandlerExceptions.java.ejs` — imports FQN + un `@ExceptionHandler` por cada `triggeredBy`, con `log.warn(ex)` y traducción al error de dominio.
- **Catalog:** nuevo `src/generators/errors-catalog-generator.js` + `templates/docs/ErrorsCatalog.md.ejs`. Wired en `src/commands/build.js`. Genera `docs/errors/{bc}-errors-catalog.md` por cada BC con summary + matriz inversa + warning de huérfanos.

### Pendientes (🟡 deferred, no críticos)

- **E2 final:** regeneración de `ErrorResponse.java` desde `*-open-api.yaml#/components/schemas/ErrorResponse` + opt-in `errorFormat: problemDetails` (RFC 7807). Cliente actual puede deserializar `code`/`message`/`details` sin esto.
- **E13:** lectura de mensajes desde `messages_*.properties` cuando `dsl-springboot.json#i18n: true`. Sin demanda inmediata.
