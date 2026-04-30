# Análisis profundo de la sección `useCases` — robustez del generador

> Diseño analizado: `C:/Users/antonio.suarez/Desktop/test-dsl/arch/`
> Código generado: `C:/Users/antonio.suarez/Desktop/test-dsl/`
> Generador: [src/generators/application-generator.js](../src/generators/application-generator.js) + [src/generators/controller-generator.js](../src/generators/controller-generator.js)
> Reader: [src/utils/bc-yaml-reader.js](../src/utils/bc-yaml-reader.js)
> Templates: [templates/application/UcCommand.java.ejs](../templates/application/UcCommand.java.ejs), [UcCommandHandler.java.ejs](../templates/application/UcCommandHandler.java.ejs), [UcQuery.java.ejs](../templates/application/UcQuery.java.ejs), [UcQueryHandler.java.ejs](../templates/application/UcQueryHandler.java.ejs), [VoRequest.java.ejs](../templates/application/VoRequest.java.ejs), [ServicePort.java.ejs](../templates/application/ServicePort.java.ejs), [controller/AggregateV1Controller.java.ejs](../templates/controller/AggregateV1Controller.java.ejs)

> **Estado:** Fase 1 implementada (G1, G4, G18 parcial — ver [docs/useCases-new-features.md](../docs/useCases-new-features.md)). El resto de gaps queda pendiente para fases posteriores. Cada gap está clasificado por severidad y propone la mínima extensión declarativa de schema necesaria. El criterio rector es el de [AGENTS.md](../AGENTS.md): el generador no infiere — si el YAML no provee el _hint_, debe emitir `// TODO useCase(<id>, <aspect>): …` y nunca completar por su cuenta.

---

## 1. Qué soporta hoy el generador

### 1.1 Schema de `useCases[]` reconocido

| Clave | Tipo | Obligatoria | Procesamiento |
|---|---|---|---|
| `id` | string | ✅ | unicidad validada en bc-yaml-reader |
| `name` | string PascalCase | ✅ | base de `${name}Command` / `${name}Query` / `${name}CommandHandler` |
| `type` | enum `command \| query` | ✅ | rama CQRS en application-generator |
| `actor` | string libre | ✅ | sólo documental (no se enforce) |
| `trigger.kind` | `http \| event` | ✅ | `http` mapea a controller; `event` a `{Bc}DomainEventHandler` |
| `trigger.operationId` | string | ✅ si http | enlaza con el OpenAPI público para resolver método y path |
| `aggregate` | string | ✅ | resuelve repos, mapper, dominio |
| `method` | string | ✅ si command | nombre del `domainMethod` invocado |
| `input[]` | lista | ❌ | parámetros del Command/Query record |
| `input[].name` | string | ✅ | nombre del campo del record |
| `input[].type` | string DSL | ✅ | resuelto por `javaTypeForCommand` / `javaTypeForDto` |
| `input[].required` | boolean | ❌ | gobierna `@NotNull`/`@NotBlank` |
| `input[].source` | `body \| path \| query \| authContext` | ✅ | `authContext` se omite del record y se inyecta en handler |
| `input[].loadAggregate` | boolean | ❌ | si `true` y el campo es id de path, emite `findById().orElseThrow(...)` |
| `returns` | string | ❌ (queries) | acepta `Page[X]`, `List[X]`, nombre de DTO/proyección o vacío |
| `rules[]` | lista de `domainRule.id` | ❌ | mapeadas vía [domain-rule-mapper.js](../src/utils/domain-rule-mapper.js) |
| `notFoundError` | string \| array | ❌ | usado por `loadAggregate` y `fkValidations` |
| `fkValidations[]` | lista | ❌ | `{ aggregate, param, error, bc? }` — local repo o ServicePort cross-BC |
| `implementation` | `full \| scaffold` | ❌ default `scaffold` | `scaffold` emite `UnsupportedOperationException` + TODO |

### 1.2 Pipeline de generación (resumen)

| Fase | Archivo | Salida |
|---|---|---|
| 1. Validación cruzada | [bc-yaml-reader.js](../src/utils/bc-yaml-reader.js) (líneas 58-460) | unicidad de `id`, integridad referencial de `rules`, `notFoundError`, `fkValidations`, `emits` |
| 2. Command/Query records | `generateCommand` / `generateQuery` + `buildCommandFields` / `buildQueryFields` | `application/commands/{Uc}Command.java`, `application/queries/{Uc}Query.java` |
| 3. VO Request records | `generateVoRequestRecord` | `application/commands/{Vo}Request.java` cuando un VO con >1 propiedad se usa como input |
| 4. ServicePorts cross-BC | `buildFkDependencies` + `generateServicePort` | `application/ports/{Bc}ServicePort.java` |
| 5. Handlers | `buildCommandHandlerBody` / `buildQueryHandlerBody` | `application/usecases/{Uc}CommandHandler.java` / `{Uc}QueryHandler.java` |
| 6. Controller HTTP | [controller-generator.js](../src/generators/controller-generator.js) | `controllers/{Aggregate}V1Controller.java` por aggregate |

### 1.3 Verificación contra `test-dsl/`

Diseños analizados: `arch/catalog`, `arch/orders`, `arch/inventory`, `arch/payments`, `arch/notifications`. Lo que **funciona correctamente** sobre el output:

| Capacidad | Evidencia en `test-dsl/src/main/java/.../catalog/` |
|---|---|
| Command record con validaciones derivadas del tipo | `CreateCategoryCommand.java` con `@NotBlank`, `@Valid`, `@NotNull` |
| VO multi-propiedad como input | `TopicsRequest.java`, `MoneyRequest.java` generados como records anidados |
| Handler `scaffold` consistente | `CreateCategoryCommandHandler.java` lanza `UnsupportedOperationException` con TODO |
| Handler `full` para queries paginadas | `ListProductsQueryHandler.java` implementa `Page<Product>` + `PagedResponse.of(...)` |
| Mapeo HTTP por OpenAPI operationId | `CategoryV1Controller.java` resuelve `POST /categories`, `GET /categories/{id}` correctamente |
| `loadAggregate: true` produce `findById` | `GetCategoryQueryHandler.java` carga aggregate antes de mapear |
| Cross-BC FK genera ServicePort | `InventoryServicePort.java` aparece en `catalog` cuando hay FK a inventory |
| Proyección como `returns` | `UC-INT-001` produce `ProductPriceSnapshot` en lugar de DTO genérico |
| Nombres de Response sin colisión con proyecciones | filtro en `controller-generator.js` línea 465 |

---

## 2. Gaps detectados

> Los gaps siguen el contrato de AGENTS.md: cada uno se resolvería con una **adición opcional y retrocompatible** al schema YAML; si el _hint_ falta, el generador debe emitir un `// TODO useCase(<id>, <aspect>)` en lugar de inferir.

### 🔴 Gaps críticos

#### G1. `errorMapping` ausente — los errores de negocio no tienen contrato HTTP ✅ RESUELTO (Fase 1)

> **Estado:** resuelto en Fase 1. Ver [docs/useCases-new-features.md § 2](../docs/useCases-new-features.md#2-errors-con-whitelist-estricta-y-httpstatus-enumerado-g1--g18) y § 3 (trazabilidad `derived_from`).
> El bloque `errors[]` ya soporta `httpStatus` enumerado {400, 401, 403, 404, 409, 422} con mapeo determinista a la excepción base correspondiente, y `HandlerExceptions` (@RestControllerAdvice) está cableado para devolver el HTTP status correcto con cuerpo RFC 7807. Cada `DomainError` generado lleva además `// derived_from: errors[<code>]`.

**Síntoma original:** `errors[]` declara semántica de dominio, pero ni el handler ni el controller saben qué `HttpStatus` debe devolver cada error. Hoy todo `RuntimeException` se traduce a `500 Internal Server Error` salvo que el humano declare manualmente un `@RestControllerAdvice`.

**Evidencia:** En `test-dsl/`, ningún `*ExceptionHandler.java` se genera; el OpenAPI público declara `404`, `409`, `422` para varios endpoints pero el código no los honra.

**Schema sugerido (a nivel `errors[]`, no `useCases[]`, para no duplicar):**
```yaml
errors:
  - name: CategoryNotFound
    httpStatus: 404
    title: "Category not found"
  - name: CategoryNameAlreadyExists
    httpStatus: 409
    title: "Category name already in use"
```

**Generación esperada:**
- `shared/infrastructure/web/RestExceptionHandler.java` con un `@ExceptionHandler` por error declarado.
- Cuerpo de respuesta tipo RFC 7807 (`type`, `title`, `status`, `detail`).
- Si `httpStatus` está ausente: `// TODO useCase(<id>, errorMapping): missing httpStatus for <error>` en el handler.

---

#### G2. `idempotencyKey` ausente — comandos no idempotentes a nivel transporte

**Síntoma:** No hay forma de declarar que un command debe deduplicarse contra un header tipo `Idempotency-Key`. Esto es crítico en `payments` (cargo doble) y `orders` (POST duplicado por timeout del cliente).

**Schema sugerido:**
```yaml
- id: UC-PAY-001
  name: ChargeCard
  type: command
  idempotency:
    header: Idempotency-Key
    ttl: 24h
    storage: database         # database | redis
```

**Generación esperada:**
- Filtro `IdempotencyFilter` que intercepta requests con el header.
- Tabla `idempotency_request` (Flyway) con `(key, request_hash, response_status, response_body, expires_at)`.
- En el controller, anotación `@Idempotent` (anotación generada en `shared/infrastructure/web/`).
- Si `idempotency` se declara sin `storage`: emit `// TODO useCase(<id>, idempotency): storage not declared`.

---

#### G3. `authorization` apenas existe — RBAC y ownership quedan en `actor` documental

**Síntoma:** El campo `actor` se usa sólo como documentación. No se generan `@PreAuthorize`, ni guards de ownership (ej. "el usuario sólo puede cancelar SUS órdenes"). El `input[].source: authContext` extrae claims pero no los usa para decisiones.

**Schema sugerido:**
```yaml
- id: UC-ORD-005
  name: CancelOrder
  type: command
  authorization:
    rolesAnyOf: [CUSTOMER, OPERATOR]
    ownership:
      field: customerId          # propiedad del aggregate
      claim: sub                 # claim del JWT
      allowRoleBypass: [OPERATOR]
```

**Generación esperada:**
- En el controller: `@PreAuthorize("hasAnyRole('CUSTOMER','OPERATOR')")`.
- En el handler: tras `loadAggregate`, guard:
  ```java
  String currentUserId = SecurityContextUtil.currentUserId();
  if (!order.getCustomerId().equals(UUID.fromString(currentUserId))
      && !SecurityContextUtil.hasRole("OPERATOR")) {
      throw new ForbiddenError("Only the order owner can cancel");
  }
  ```
- Si `authorization` está incompleta: `// TODO useCase(<id>, authorization): <missing>`.

---

#### G4. Sin soporte declarativo para `command` que retorna valor ✅ RESUELTO (Fase 1)

> **Estado:** resuelto en Fase 1. Ver [docs/useCases-new-features.md § 1](../docs/useCases-new-features.md#1-returns-en-commands--post-que-devuelve-el-recurso-creado-g4).
> Cuando un command declara `returns: <DtoOrProjection>`, el generador produce `ReturningCommand<R>` + `ReturningCommandHandler<C, R>` y el controller emite `return useCaseMediator.dispatch(command)`. Sin `returns`, el comportamiento es exactamente el anterior (`Command` / `void`), por lo que la retrocompatibilidad es total. Acepta las mismas formas que en queries: `X`, `List[X]`, `Page[X]`, proyecciones.

**Síntoma original:** Todos los `CommandHandler.handle()` retornan `void`. Esto rompe el caso real de "POST devuelve el id/recurso creado". Hoy el controller hace `useCaseMediator.dispatch(command)` y devuelve `void`, lo que contradice el OpenAPI cuando la operación está declarada con `responses.201.content.application/json`.

**Evidencia:** `CategoryV1Controller.createCategory(...)` devuelve `void` aunque el OpenAPI declare `201` con cuerpo `CategoryResponse`.

**Schema sugerido:**
```yaml
- id: UC-CAT-001
  name: CreateCategory
  type: command
  returns: CategoryResponse        # ← nuevo en commands
```

**Generación esperada:**
- `Command<CategoryResponse>` con tipo de retorno parametrizado.
- `CommandHandler<CreateCategoryCommand, CategoryResponse>`.
- Handler `full`: `return mapper.toResponseDto(category)` tras `save`.
- Controller: `return useCaseMediator.dispatch(...)`.
- Sin `returns`: comportamiento actual (void) preservado.

---

#### G5. Sin soporte para `input` con valor por defecto / coerción de tipos en queries

**Síntoma:** El `ListProductsQuery` recibe `String status, String categoryId, int page, int size` y el handler hace `ProductStatus.valueOf(query.status())` con un `if != null` manualmente reconstruido. Si el OpenAPI declara `default: 0`, no se honra. Tipos en query string siempre llegan como `String`, sin parser.

**Schema sugerido:**
```yaml
input:
  - name: status
    type: ProductStatus           # tipado fuerte aceptado en source: query
    source: query
    default: ACTIVE
  - name: page
    type: Integer
    source: query
    default: 0
  - name: size
    type: Integer
    source: query
    default: 20
    max: 100
```

**Generación esperada:**
- Query record con `ProductStatus status`, `int page`, `int size` (sin Strings).
- Controller: `@RequestParam(defaultValue = "ACTIVE") ProductStatus status`, `@RequestParam(defaultValue = "0") int page`.
- Validación `size <= 100` emitida como `@Max(100)`.

---

#### G6. Multi-aggregate transactions / sagas locales no expresables

**Síntoma:** El generador asume **un aggregate por UC**. Una operación como "ConfirmOrder" que toca `Order` + `Inventory` requiere actualmente dos UCs encadenados o trabajo manual completo. Para escenarios "transacción local con dos agregados en mismo BC" (válido en DDD si comparten consistency boundary) no hay schema.

**Schema sugerido:**
```yaml
- id: UC-ORD-010
  name: ConfirmOrderWithInventory
  type: command
  aggregates: [Order, Inventory]      # NUEVO: array
  steps:
    - aggregate: Order
      method: confirm
    - aggregate: Inventory
      method: reserve
      onFailure:
        compensate: { aggregate: Order, method: cancel }
```

**Generación esperada:**
- Handler con `@Transactional` que carga ambos repos.
- Bloque `try/catch` con compensación documentada.
- Si `aggregates` tiene >1 y faltan `steps`: `// TODO useCase(<id>, multiAggregate): declare steps`.
- Para sagas distribuidas (cross-BC) se mantiene la sección `system.yaml/sagas` ya existente — este gap aplica sólo a transacciones locales.

---

### 🟠 Gaps mayores

#### G7. Pagination y sorting no parametrizables

**Síntoma:** El generador detecta `page`/`size` por convención mágica (campos llamados `page` y `size` con tipo `Integer`). No hay `sortBy`, `sortDirection`, ni whitelist de campos ordenables. El repo se elige por nombre adivinado.

**Schema sugerido:**
```yaml
- id: UC-PRD-004
  name: ListProducts
  type: query
  pagination:
    defaultSize: 20
    maxSize: 100
    sortable: [createdAt, price, name]
    defaultSort: { field: createdAt, direction: DESC }
```

**Generación esperada:**
- Query record con `String sortBy`, `Sort.Direction sortDirection`.
- Controller con `@RequestParam(defaultValue = "createdAt") String sortBy` + validación contra whitelist.
- Handler construye `PageRequest.of(page, size, Sort.by(direction, sortBy))`.
- Repo: ya soporta `Pageable`; sólo se elimina la heurística de detección de `page/size`.

---

#### G8. Filtros declarativos — rangos, búsqueda full-text, `in`

**Síntoma:** El campo `search: String` aparece en queries pero el generador no sabe qué hacer con él. Filtros tipo `priceMin`/`priceMax`, `createdAfter`/`createdBefore`, o `categoryIds: List[Uuid]` no tienen mapeo a métodos de repo.

**Schema sugerido:**
```yaml
input:
  - name: priceRange
    type: Range[Decimal]            # NUEVO: Range[T]
    source: query
  - name: createdRange
    type: Range[DateTime]
    source: query
  - name: categoryIds
    type: List[Uuid]
    source: query
  - name: search
    type: SearchText
    fields: [name, description]     # qué campos del aggregate buscar
    source: query
```

**Generación esperada:**
- Query record con sub-records `RangeQuery<BigDecimal>`.
- Repo método con `Specification<Product>` (JPA Criteria) o emisión de TODO si se prefiere mantener simple.
- Controller acepta `priceMin`/`priceMax` como query params separados pero los agrupa en el record.

---

#### G9. Bulk operations no expresables

**Síntoma:** No hay forma de declarar "POST /products/bulk" que cree N productos en un solo request con error reporting por item.

**Schema sugerido:**
```yaml
- id: UC-PRD-020
  name: BulkCreateProducts
  type: command
  bulk:
    itemType: CreateProductCommand   # reutiliza un command existente
    maxItems: 1000
    onItemError: continue            # continue | abort
```

**Generación esperada:**
- Command `BulkCreateProductsCommand(@Valid @Size(max=1000) List<CreateProductCommand> items)`.
- Handler que itera y produce `BulkResult<UUID>` con `successes[]` + `errors[{ index, code, message }]`.
- Controller con `@PostMapping("/products/bulk")`.

---

#### G10. Async / long-running commands

**Síntoma:** Todo command es síncrono y bloqueante. Para operaciones largas (export CSV, recálculo masivo, llamada a sistema externo lento) no hay forma de devolver `202 Accepted` con un `jobId` consultable.

**Schema sugerido:**
```yaml
- id: UC-RPT-001
  name: GenerateMonthlyReport
  type: command
  async:
    mode: jobTracking              # jobTracking | fireAndForget
    statusEndpoint: getReportJobStatus  # operationId del OpenAPI
```

**Generación esperada:**
- Handler retorna `JobReference(UUID jobId)`.
- Tabla `async_job` (Flyway) con `(id, type, status, payload, result, created_at, updated_at)`.
- Controller responde `202` con `Location: /api/.../jobs/{jobId}`.
- Worker `@Scheduled` o `@Async` no se infiere — se emite `// TODO useCase(<id>, async): implement worker`.

---

#### G11. `input.source: header` ausente

**Síntoma:** Sólo se aceptan `body | path | query | authContext`. No es posible declarar un input que venga de un header HTTP arbitrario (`X-Tenant-Id`, `X-Trace-Id`, `Accept-Language`, etc.).

**Schema sugerido:**
```yaml
input:
  - name: tenantId
    type: Uuid
    source: header
    headerName: X-Tenant-Id
    required: true
```

**Generación esperada:**
- Controller: `@RequestHeader(value = "X-Tenant-Id", required = true) UUID tenantId`.
- Pasado al constructor del Command/Query como cualquier otro parámetro.

---

#### G12. File upload / download (multipart, streaming)

**Síntoma:** No hay soporte para `multipart/form-data` (subir imagen de producto) ni para descargar un blob. El OpenAPI puede declarar `application/octet-stream` pero el generador lo trata como JSON.

**Schema sugerido:**
```yaml
input:
  - name: image
    type: File                       # NUEVO: tipo canónico File
    source: multipart
    partName: file
    maxSize: 5MB
    contentTypes: [image/png, image/jpeg]

returns: BinaryStream                # NUEVO: para descargas
```

**Generación esperada:**
- Controller: `@RequestPart("file") MultipartFile file`.
- Validación de tamaño y MIME.
- Para descarga: handler retorna `Resource` o `StreamingResponseBody`.

---

#### G13. `fkValidations` cross-BC siempre emite TODO

**Síntoma:** El ServicePort se genera, pero la llamada en el handler queda como `// TODO call inventoryServicePort.existsCategory(...)` cuando es cross-BC. Se rompe el contrato "implementation: full = código ejecutable".

**Schema sugerido:** ninguno — basta con que el generador emita la llamada real al port (que ya tiene método `existsX(UUID)`):
```java
if (!inventoryServicePort.existsItem(command.itemId())) {
    throw new ItemNotFoundError();
}
```

**Notas:** la implementación HTTP del adapter sí está cubierta por la fase 1 de integraciones (ver [docs/integrations-new-features.md](../docs/integrations-new-features.md)), por tanto la cadena puede cerrarse sin nuevo schema.

---

### 🟡 Gaps menores

#### G14. `actor` no se vincula a `system.yaml.actors`

`actor: operator` es texto libre. No hay validación cruzada contra los actores declarados a nivel sistema. Una errata (`oprator`) pasa silenciosa. **Fix:** validar membership de `useCases[].actor` contra `system.yaml.actors[]` y emitir error tipo `INT-022`.

#### G15. `trigger.kind: event` mínimamente soportado

Para `kind: event` el generador genera el listener en `{Bc}DomainEventHandler`, pero no permite declarar `consumes: <EventName>` por UC, ni mapear filtros (ej. "consumir sólo si payload.status == ACTIVE"). Casos de UC reactivos quedan sin cobertura clara.

**Schema sugerido:**
```yaml
- id: UC-INV-005
  name: AdjustStockOnOrderPlaced
  type: command
  trigger:
    kind: event
    consumes: OrderPlaced
    fromBc: orders
    filter: "payload.totalAmount > 0"   # opcional, SpEL o documental
```

#### G16. Sin `description` ni `goal` en `useCases[]`

No hay clave para Javadoc. El handler generado no documenta qué hace. Añadir:
```yaml
- id: UC-CAT-001
  name: CreateCategory
  description: |
    Crea una nueva categoría de catálogo. La unicidad por nombre se valida
    contra el repo. El slug se genera derivado de `name`.
```
y propagar a Javadoc en `Command`, `CommandHandler`, `Query`, `QueryHandler`.

#### G17. `derived_from` no se emite en handlers ni records

A diferencia de aggregates y domainEvents (donde sí se emite trazabilidad), los UCs no llevan `// derived_from: useCases[<id>]` en ningún artefacto. **Fix:** añadirlo en cada record y handler para mantener el contrato de trazabilidad obligatoria de AGENTS.md sección "Reglas de generación inviolables / 3".

#### G18. Whitelist estricta de claves no aplicada ✅ RESUELTO (Fase 1, parcial)

> **Estado:** resuelto en Fase 1 para `useCases[]`, `useCases[].trigger`, `useCases[].input[]`, `useCases[].fkValidations[]` y `errors[]`. Ver [src/utils/bc-yaml-reader.js](../src/utils/bc-yaml-reader.js) (`ALLOWED_UC_KEYS`, `ALLOWED_UC_TRIGGER_KEYS`, `ALLOWED_UC_INPUT_KEYS`, `ALLOWED_UC_FK_KEYS`, `ALLOWED_ERROR_KEYS`).
> Erratas como `triger:` o `htppStatus:` ahora abortan el build con `unsupported attribute "<key>"`. Pendiente extender el patrón a otros bloques no relacionados con UCs.

**Síntoma original:** `bc-yaml-reader.js` valida unicidad y referencias, pero **no rechazaba claves desconocidas** dentro de `useCases[]` ni dentro de `useCases[].input[]`. Una errata como `triger:` o `inputs:` pasaba silenciosa y producía código incompleto. **Fix:** aplicar la misma whitelist estricta que ya se hizo para `domainRules[]` en Tier 2 de aggregates.

#### G19. `Command` y `Query` records no llevan ID estable / correlación

No hay forma de propagar `correlationId` desde el controller al handler de forma estándar. La correlación existe a nivel de eventos (Fase 1 domainEvents) pero no para UCs HTTP. **Fix:** generar todos los Commands con un campo opcional `EventMetadata metadata` opcional o un `CommandContext` aparte.

#### G20. Validaciones cross-field no expresables

`@AssertTrue`-style ("si `status == DRAFT` entonces `publishedAt` debe ser null") no tienen schema. **Fix:**
```yaml
- id: UC-PRD-002
  name: UpdateProduct
  validations:
    - id: UPD-CHK-001
      expression: "publishedAt == null || status != DRAFT"
      errorCode: PRODUCT_PUBLISH_INCONSISTENCY
```
emitido como un `@AssertTrue` con método derivado, o como guard en el handler con `// TODO` si no es trivial.

#### G21. Caché de queries

No hay forma de declarar `@Cacheable`. **Fix:**
```yaml
- id: UC-CAT-002
  name: GetCategory
  type: query
  cache:
    ttl: 5m
    key: "id"
    evictOn: [UpdateCategory, DeleteCategory]
```
genera `@Cacheable(value="category", key="#query.id()")` y `@CacheEvict` en los commands listados.

#### G22. Rate limiting / throttling

No hay schema. **Fix:**
```yaml
rateLimit:
  perActor: 100
  window: 1m
  strategy: tokenBucket
```

#### G23. `LogExceptions` aplicado uniformemente — sin niveles

El handler siempre lleva `@LogExceptions`. No hay forma de declarar nivel (debug/info/warn) ni excluir cierto error de logging (ej. errores de validación esperados que ensucian logs). **Fix menor.**

#### G24. Returns no admite `Optional[X]` ni `Void`

`returns: Optional[ProductSummary]` no se reconoce; los queries siempre asumen "encontrado o lanza". Algunos endpoints REST devuelven `404` natural si no existe, otros devuelven `200` con cuerpo nulo. **Fix:** soportar wrappers explícitos `Optional[X]`, `Void`, además de los ya soportados `Page[X]`, `List[X]`.

---

## 3. Resumen y priorización

| Prioridad | Gap | Tamaño | Impacto | Estado |
|---|---|---|---|---|
| P0 | G1 errorMapping → HTTP status | S | Hace que el código generado deje de devolver `500` por errores de negocio | ✅ Fase 1 |
| P0 | G4 commands con `returns` | S | Cierra brecha controller↔OpenAPI (POST devuelve 201 + body) | ✅ Fase 1 |
| P0 | G18 whitelist estricta de claves UC + errors | XS | Higiene básica de schema, mismo patrón ya aplicado a otros bloques | ✅ Fase 1 |
| P0 | G14 validar `actor` contra `system.yaml.actors` | XS | Detecta erratas en `actor` | ⏳ Pendiente |
| P1 | G2 idempotency | M | Crítico para pagos y POST repetibles | ⏳ Pendiente |
| P1 | G3 authorization (RBAC + ownership) | M | Seguridad declarativa | ⏳ Pendiente |
| P1 | G5 defaults + tipado fuerte en query params | S | Elimina `String→enum` manual y `if != null` en handlers | ⏳ Pendiente |
| P1 | G7 pagination/sorting declarativos | S | Reemplaza la heurística mágica `page/size` | ⏳ Pendiente |
| P1 | G13 cierre de cadena cross-BC FK | XS | Elimina TODOs en handlers `full` | ⏳ Pendiente |
| P2 | G6 multi-aggregate local | L | Habilita transacciones locales legítimas | ⏳ Pendiente |
| P2 | G9 bulk | M | Necesario para imports | ⏳ Pendiente |
| P2 | G10 async/job tracking | L | Operaciones largas | ⏳ Pendiente |
| P2 | G11 source: header | XS | Tenant-id, trace-id, language | ⏳ Pendiente |
| P2 | G12 multipart upload/download | M | Imágenes, exports | ⏳ Pendiente |
| P2 | G16/G17 description + derived_from | XS | Trazabilidad AGENTS.md compliant | ⏳ Pendiente |
| P3 | G8 filtros range/search/in | M | Listados ricos | ⏳ Pendiente |
| P3 | G15 trigger.kind: event enriquecido | S | UCs reactivos | ⏳ Pendiente |
| P3 | G19 correlationId end-to-end | S | Tracing completo HTTP→evento | ⏳ Pendiente |
| P3 | G20 validaciones cross-field | M | Reglas de coherencia | ⏳ Pendiente |
| P3 | G21–G24 cache, rate-limit, log levels, Optional/Void returns | S c/u | Refinamientos | ⏳ Pendiente |

---

## 4. Reglas que se mantienen invariantes

Las extensiones propuestas respetan los principios de [VISION.md](../VISION.md) y [AGENTS.md](../AGENTS.md):

1. **Agnosticismo tecnológico**: cada nueva clave declara intención (`idempotency`, `authorization`, `pagination`) sin referenciar Spring, Resilience4j, Redis ni JPA. La elección concreta sigue siendo del generador.
2. **Determinismo**: el mismo YAML produce el mismo código. Los hints son opcionales pero, una vez declarados, su mapeo es fijo.
3. **No-inferencia**: si un hint está incompleto, el generador emite `// TODO useCase(<id>, <aspecto>): <causa>` y nunca completa.
4. **Retrocompatibilidad**: todos los UCs actuales del `test-dsl/` siguen produciendo el mismo código sin tocar el YAML.
5. **Trazabilidad**: cada artefacto generado incluirá `// derived_from: useCases[<id>]` (gap G17 lo formaliza).

---

## 5. Limitaciones que NO se proponen resolver

- **Lógica de negocio compleja** dentro de `implementation: scaffold` — sigue siendo responsabilidad de la Fase 3 (IA + flows.md). El generador NO debe intentar generar el `execute()` real de un UC con reglas no triviales aunque se le añadan más hints.
- **Generación de tests** a partir de `{bc-name}-flows.md` — fuera de scope de este análisis (pertenece a un eventual `test-generator`).
- **Workflow engine / BPMN** — sagas distribuidas se siguen modelando en `system.yaml/sagas`, no en `useCases[]`.
- **Versionado de API por UC** — el versionado vive en el OpenAPI; el UC no debería duplicarlo.
