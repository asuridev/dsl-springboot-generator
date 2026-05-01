# Referencia de `{bc}.yaml` — Parte 3: Use Cases

La sección `useCases` es la más rica del YAML táctico. Declara todas las operaciones
que el BC expone o en las que reacciona, incluyendo la lógica de autorización,
idempotencia, paginación, validaciones cruzadas, y comportamiento asíncrono.

---

## Tabla de contenidos

1. [Estructura mínima de un use case](#1-estructura-mínima)
2. [Propiedades base](#2-propiedades-base)
3. [Bloque `trigger`](#3-bloque-trigger)
4. [Bloque `input`](#4-bloque-input)
5. [Propiedad `returns`](#5-propiedad-returns)
6. [Bloque `authorization`](#6-bloque-authorization)
7. [Bloque `pagination`](#7-bloque-pagination)
8. [Bloque `idempotency`](#8-bloque-idempotency)
9. [Bloque `bulk`](#9-bloque-bulk)
10. [Bloque `async`](#10-bloque-async)
11. [Propiedad `rules`](#11-propiedad-rules)
12. [Propiedad `notFoundError` y `lookups`](#12-notfounderror-y-lookups)
13. [Propiedad `fkValidations`](#13-fkvalidations)
14. [Propiedad `validations`](#14-propiedad-validations)
15. [Propiedad `emits`](#15-propiedad-emits)
16. [Multi-agregado: `aggregates` + `steps`](#16-multi-agregado-aggregates--steps)
17. [Propiedad `implementation`](#17-propiedad-implementation)
18. [Ejemplos completos](#18-ejemplos-completos)

---

## 1. Estructura mínima

```yaml
useCases:

  # Comando HTTP mínimo
  - id: UC-PRD-001
    name: CreateProduct
    type: command
    actor: admin
    trigger:
      kind: http
      operationId: createProduct
    aggregate: Product
    method: create
    input:
      - name: sku
        type: String(50)
        source: body
        required: true
      - name: name
        type: String(200)
        source: body
        required: true
    implementation: scaffold

  # Query HTTP mínimo
  - id: UC-PRD-010
    name: GetProductById
    type: query
    actor: customer
    trigger:
      kind: http
      operationId: getProductById
    aggregate: Product
    input:
      - name: productId
        type: Uuid
        source: path
        required: true
        loadAggregate: true
    returns: ProductDetail
    notFoundError: PRODUCT_NOT_FOUND
```

---

## 2. Propiedades base

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `id` | `UC-{PREFIX}-{NNN}` | ✅ | Identificador único del use case en el BC. Referenciado en transiciones de enum y en `rules[]`. |
| `name` | PascalCase | ✅ | Nombre del use case. Genera `{Name}Command.java`, `{Name}Handler.java`, `{Name}Query.java`, etc. |
| `type` | `command` \| `query` | ✅ | Determina si el UC modifica estado o solo lo consulta. |
| `actor` | string | no | Actor que desencadena el UC. Si `system.yaml` declara `actors[]`, debe ser uno de los declarados (validación G14). |
| `description` | texto | no | Solo referencia. |
| `aggregate` | PascalCase | no | Agregado principal del UC. Requerido para comandos que declaran `method`. |
| `method` | camelCase | no | Método del dominio a invocar. Debe declararse en `aggregates[].domainMethods`. |

---

## 3. Bloque `trigger`

Define cómo se activa el use case.

### 3.1 `trigger.kind: http`

Activa el use case mediante una petición REST. El generador crea el endpoint en el
controller y vincula el `operationId` con la operación en el OpenAPI del BC.

```yaml
trigger:
  kind: http
  operationId: createProduct    # debe coincidir con operationId en {bc}-open-api.yaml
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `kind` | `http` | ✅ | |
| `operationId` | camelCase | ✅ | Referencia a una operación en `{bc}-open-api.yaml`. Determina método HTTP, path y parámetros del endpoint. |

**Código Java generado** — fragmento del controller:
```java
@PostMapping("/products")
@ResponseStatus(HttpStatus.CREATED)
public ResponseEntity<ProductSummary> createProduct(
    @RequestBody @Valid CreateProductRequest request) {

    CreateProductCommand command = mapper.toCommand(request);
    UUID productId = mediator.send(command);
    return ResponseEntity.created(URI.create("/products/" + productId)).build();
}
```

---

### 3.2 `trigger.kind: event`

Activa el use case cuando se recibe un evento del broker. El generador crea un
consumer listener que convierte el evento en un command/query y lo despacha.

```yaml
trigger:
  kind: event
  consumes: ProductActivated     # nombre del evento (canónico; "event" es alias legacy)
  channel: catalog.product.activated   # opcional: canal AsyncAPI
  fromBc: catalog                # opcional: BC que publica el evento
  filter: "amount.compareTo(BigDecimal.ZERO) > 0"   # opcional: filtro Java
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `kind` | `event` | ✅ | |
| `consumes` | PascalCase | ✅ | Nombre del evento consumido. Debe existir en `domainEvents.consumed[]` o `domainEvents.published[]`. Alias: `event` (legacy). |
| `channel` | string | no | Canal AsyncAPI. Informativo; el generador lo usa para configurar la binding del listener. |
| `fromBc` | kebab-case | no | BC que publica el evento. Usado en la validación INT-007. |
| `filter` | expresión Java | no | Expresión booleana evaluada sobre el evento deserializado. Solo se procesa el evento si la expresión es `true`. |

**Código Java generado** — consumer listener:
```java
@Component
public class ProductActivatedConsumer {

    private final UseCaseMediator mediator;

    @RabbitListener(queues = "inventory.product-activated")
    // o @KafkaListener(topics = "catalog.product.activated")
    public void handle(ProductActivated event) {
        // [G15] filter evaluado: amount.compareTo(BigDecimal.ZERO) > 0
        if (!(event.amount().compareTo(BigDecimal.ZERO) > 0)) {
            return;
        }
        CreateStockItemCommand command = new CreateStockItemCommand(
            event.productId(),
            event.price()
        );
        mediator.send(command);
    }
}
```

---

## 4. Bloque `input`

Lista los parámetros de entrada del use case. Cada entrada representa un campo del
command o query object.

```yaml
input:
  # Parámetro de body (POST/PUT)
  - name: sku
    type: String(50)
    source: body
    required: true

  # Parámetro de path (GET /products/{productId})
  - name: productId
    type: Uuid
    source: path
    required: true
    loadAggregate: true     # el generador añade findById.orElseThrow en el handler

  # Parámetro de query string (?status=ACTIVE)
  - name: status
    type: ProductStatus
    source: query
    required: false
    default: ACTIVE

  # Parámetro del contexto de seguridad (JWT claim)
  - name: currentUserId
    type: Uuid
    source: authContext
    required: true

  # Parámetro de header HTTP
  - name: tenantId
    type: Uuid
    source: header
    headerName: X-Tenant-Id
    required: true

  # Archivo multipart
  - name: image
    type: File
    source: multipart
    partName: file
    maxSize: 10MB
    contentTypes:
      - image/png
      - image/jpeg

  # Búsqueda de texto libre
  - name: searchTerm
    type: SearchText
    source: query
    required: false
    fields:
      - name           # propiedades del agregado donde se aplica LIKE
      - description

  # Rango numérico
  - name: priceRange
    type: Range[Decimal]
    source: query
    required: false

  # Valor con límite máximo
  - name: quantity
    type: Integer
    source: body
    required: true
    max: 1000
```

### Propiedades de un input

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | camelCase | ✅ | Nombre del parámetro. Campo del command/query record. |
| `type` | tipo canónico | ✅ | Tipo del parámetro. |
| `source` | enum | ✅ | De dónde proviene el valor. Ver tabla siguiente. |
| `required` | boolean | no | Si `true`: `@NotNull` en el command/query. Default: `false`. |
| `default` | valor | no | Valor por defecto cuando no se provee. Solo válido para `source: query`. |
| `max` | integer | no | Valor máximo. Solo para `Integer`, `Long`, `Decimal`. Genera `@Max` en el DTO. |
| `loadAggregate` | boolean | no | Si `true`, el generador emite `findById(command.{name}()).orElseThrow(notFoundError::new)` al inicio del handler. |
| `headerName` | string | ✅ si `source: header` | Nombre del header HTTP (e.g. `X-Tenant-Id`). |
| `partName` | string | no | Nombre de la parte multipart. Solo si `source: multipart`. |
| `maxSize` | `{N}{B\|KB\|MB\|GB}` | no | Tamaño máximo del archivo. Solo si `source: multipart`. |
| `contentTypes` | lista MIME | no | MIME types aceptados. Solo si `source: multipart`. |
| `fields` | lista camelCase | ✅ si `type: SearchText` | Propiedades del agregado sobre las que se aplica la búsqueda LIKE. Deben existir en el agregado. |

### Valores de `source`

| Valor | Genera en el controller | Genera en el command/query |
|---|---|---|
| `body` | `@RequestBody @Valid RequestDto` | Campo del record |
| `path` | `@PathVariable UUID productId` | Campo del record |
| `query` | `@RequestParam(required=false) String status` | Campo del record |
| `authContext` | Inyección desde `SecurityContextHolder` | Campo del record (tipo Uuid) |
| `header` | `@RequestHeader("X-Tenant-Id") UUID tenantId` | Campo del record |
| `multipart` | `@RequestPart("file") MultipartFile image` | Campo del record (tipo MultipartFile) |

> **Restricción:** `source: multipart` y `source: body` son mutuamente excluyentes en
> el mismo use case (Spring no puede mezclar `@RequestPart` y `@RequestBody`).

### Código Java generado — command y handler

Para el use case `CreateProduct`:

**`CreateProductCommand.java`:**
```java
package com.canastaShop.catalog.application.commands;

import java.util.UUID;

public record CreateProductCommand(
    String sku,
    String name,
    BigDecimal priceAmount,
    String priceCurrency,
    UUID categoryId,
    UUID currentUserId   // source: authContext
) {}
```

**`CreateProductHandler.java`:**
```java
@Component
@Transactional
public class CreateProductHandler implements CommandHandler<CreateProductCommand, UUID> {

    private final ProductRepository productRepository;
    private final CategoryRepository categoryRepository;

    @Override
    public UUID execute(CreateProductCommand command) {
        // lookups / fkValidations
        Category category = categoryRepository.findById(command.categoryId())
            .orElseThrow(ProductCategoryNotFoundError::new);

        // domainRule(PRD-RULE-002): uniqueness PRE-CHECK
        if (productRepository.findBySku(command.sku()).isPresent()) {
            throw new ProductSkuAlreadyExistsError();
        }

        // domainRule(PRD-RULE-004): crossAggregateConstraint
        if (category.getStatus() != CategoryStatus.ACTIVE) {
            throw new ProductCategoryNotActiveError();
        }

        // invoke domain method
        Product product = Product.create(command.sku(), command.name(),
            new Money(command.priceAmount(), command.priceCurrency()), command.categoryId());

        productRepository.save(product);
        return product.getId();
    }
}
```

### `source: authContext`

**Problema que resuelve:** el handler necesita saber quién ejecuta la operación (para
auditoría, ownership, o lógica de negocio) pero no quiere depender del contexto de
seguridad directamente. Con `source: authContext`, el generador extrae el claim del JWT
en el controller y lo pasa como parámetro explícito del command.

```yaml
input:
  - name: currentUserId
    type: Uuid
    source: authContext
    required: true
```

**Generado en el controller:**
```java
@PostMapping("/products")
public ResponseEntity<?> createProduct(
    @RequestBody @Valid CreateProductRequest request,
    @AuthenticationPrincipal JwtAuthenticationToken token) {

    UUID currentUserId = UUID.fromString(token.getTokenAttributes().get("userId").toString());
    CreateProductCommand command = new CreateProductCommand(
        request.sku(), request.name(), request.priceAmount(), request.priceCurrency(),
        request.categoryId(), currentUserId
    );
    // ...
}
```

### `type: SearchText` con `fields`

**Problema que resuelve:** implementar búsqueda full-text-ish sobre múltiples campos sin
escribir SQL a mano. El generador produce una `Specification<ProductJpa>` que construye
una cláusula `LIKE` sobre cada campo declarado.

```yaml
input:
  - name: searchTerm
    type: SearchText
    source: query
    fields:
      - name
      - description
      - sku
```

**Código generado** — `ProductSpecification.java`:
```java
public static Specification<ProductJpa> searchText(String searchTerm) {
    return (root, query, cb) -> {
        if (searchTerm == null || searchTerm.isBlank()) return cb.conjunction();
        String pattern = "%" + searchTerm.toLowerCase() + "%";
        return cb.or(
            cb.like(cb.lower(root.get("name")), pattern),
            cb.like(cb.lower(root.get("description")), pattern),
            cb.like(cb.lower(root.get("sku")), pattern)
        );
    };
}
```

### `type: Range[T]`

**Problema que resuelve:** filtros de rango (`precio entre X y Y`) requieren dos
parámetros opcionales. Con `Range[T]`, se declara un solo parámetro que encapsula ambos.

```yaml
input:
  - name: priceRange
    type: Range[Decimal]
    source: query
```

**Generado en el query handler:**
```java
public record SearchProductsQuery(
    String searchTerm,
    Range<BigDecimal> priceRange   // ← record de dos campos: min, max (ambos opcionales)
) {}
```

**En el controller:**
```java
@GetMapping("/products")
public Page<ProductSummary> searchProducts(
    @RequestParam(required = false) String searchTerm,
    @RequestParam(required = false) BigDecimal priceRangeMin,
    @RequestParam(required = false) BigDecimal priceRangeMax) {

    Range<BigDecimal> priceRange = new Range<>(priceRangeMin, priceRangeMax);
    SearchProductsQuery query = new SearchProductsQuery(searchTerm, priceRange);
    // ...
}
```

---

## 5. Propiedad `returns`

Define el tipo de retorno de un use case.

```yaml
# Query que devuelve una projection
- id: UC-PRD-010
  type: query
  returns: ProductDetail

# Query que devuelve una lista
- id: UC-PRD-011
  type: query
  returns: List[ProductSummary]

# Query que devuelve una página
- id: UC-PRD-012
  type: query
  returns: ProductSummary   # cuando pagination está declarado, se envuelve en Page<T>

# Query que descarga un archivo binario
- id: UC-PRD-020
  type: query
  returns: BinaryStream

# Comando que devuelve el ID del nuevo recurso (convención: Uuid)
- id: UC-PRD-001
  type: command
  returns: Uuid             # opcional; por convención se retorna el ID
```

| Valor | Java generado | Notas |
|---|---|---|
| Projection / VO / tipo canónico | `T` | Retorno directo. |
| `List[T]` | `List<T>` | Lista completa, sin paginación. |
| `BinaryStream` | `ResponseEntity<Resource>` | Solo válido en queries. El controller genera `application/octet-stream`. |
| `Uuid` | `UUID` | Retorna el ID del recurso creado. |
| (cuando `pagination` está declarado) | `Page<T>` | `returns` declara el tipo del elemento; el generador añade `Page<>`. |

**`BinaryStream` generado en controller:**
```java
@GetMapping("/products/{productId}/export")
public ResponseEntity<Resource> exportProduct(@PathVariable UUID productId) {
    Resource resource = mediator.send(new ExportProductQuery(productId));
    return ResponseEntity.ok()
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=product-" + productId + ".csv")
        .body(resource);
}
```

---

## 6. Bloque `authorization`

Controla quién puede ejecutar el use case. El generador produce anotaciones Spring
Security o guardas imperativas en el handler.

```yaml
authorization:
  rolesAnyOf:
    - ROLE_ADMIN
    - ROLE_CATALOG_MANAGER

  ownership:
    field: ownerId           # propiedad del agregado a comparar
    claim: userId            # claim del JWT con el ID del usuario actual
    allowRoleBypass:
      - ROLE_ADMIN           # roles que pueden saltarse la verificación de ownership
```

### Propiedades de `authorization`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `rolesAnyOf` | lista strings | no | El usuario debe tener al menos uno de estos roles. Genera `@PreAuthorize`. |
| `ownership` | objeto | no | Verifica que el usuario actual sea el dueño del recurso. |
| `ownership.field` | camelCase | ✅ | Propiedad del agregado que contiene el ID del dueño. |
| `ownership.claim` | string | ✅ | Claim del JWT que identifica al usuario actual. |
| `ownership.allowRoleBypass` | lista strings | no | Roles que pueden saltarse la verificación de ownership. |

### Código Java generado

**Con solo `rolesAnyOf`:**
```java
@PreAuthorize("hasAnyRole('ROLE_ADMIN', 'ROLE_CATALOG_MANAGER')")
@PostMapping("/products")
public ResponseEntity<?> createProduct(...) { ... }
```

**Con `ownership`:**
```java
// En el handler, tras cargar el agregado:
UUID currentUserId = command.currentUserId(); // source: authContext
if (!product.getOwnerId().equals(currentUserId)
    && !SecurityUtils.hasAnyRole("ROLE_ADMIN")) {
    throw new AccessDeniedException("You are not the owner of this resource");
}
```

---

## 7. Bloque `pagination`

Habilita la paginación de resultados en queries de tipo lista.

**Problema que resuelve:** las queries que devuelven listas crecen en tamaño con el
tiempo. Sin paginación, la aplicación devuelve todos los registros a la vez, lo que
degrada el rendimiento. Con paginación declarativa, el generador produce la lógica
completa de `Pageable` + `Page<T>`.

```yaml
- id: UC-PRD-012
  name: SearchProducts
  type: query
  pagination:
    defaultSize: 20         # tamaño de página por defecto (default: 20)
    maxSize: 100            # tamaño máximo permitido (default: 100)
    sortable:               # campos por los que se puede ordenar
      - name
      - price
      - createdAt
    defaultSort:
      field: createdAt      # campo de ordenación por defecto (debe estar en sortable)
      direction: DESC       # ASC o DESC (default: ASC)
```

### Propiedades de `pagination`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `defaultSize` | integer positivo | no | Elementos por página cuando no se especifica `size`. Default: 20. |
| `maxSize` | integer positivo | no | Límite superior del parámetro `size`. Default: 100. |
| `sortable` | lista camelCase | no | Campos por los que se puede ordenar. Si `defaultSort.field` está declarado, debe aparecer aquí. |
| `defaultSort` | objeto | no | Ordenación por defecto. |
| `defaultSort.field` | camelCase | ✅ si `defaultSort` | Debe estar en `sortable`. |
| `defaultSort.direction` | `ASC` \| `DESC` | no | Dirección. Default: `ASC`. |

### Código Java generado

**Query record:**
```java
public record SearchProductsQuery(
    String searchTerm,
    ProductStatus status,
    Pageable pageable   // ← inyectado por el generador cuando pagination está declarado
) {}
```

**Controller:**
```java
@GetMapping("/products")
public Page<ProductSummary> searchProducts(
    @RequestParam(required = false) String searchTerm,
    @RequestParam(required = false) ProductStatus status,
    @PageableDefault(size = 20, sort = "createdAt", direction = Sort.Direction.DESC)
    @SortDefault.SortDefaults({
        @SortDefault(sort = "createdAt", direction = Sort.Direction.DESC)
    })
    Pageable pageable) {

    // Validar campo de ordenación
    Set<String> allowedSortFields = Set.of("name", "price", "createdAt");
    pageable.getSort().forEach(order -> {
        if (!allowedSortFields.contains(order.getProperty())) {
            throw new InvalidSortFieldError();
        }
    });

    // Validar tamaño máximo
    if (pageable.getPageSize() > 100) {
        pageable = PageRequest.of(pageable.getPageNumber(), 100, pageable.getSort());
    }

    return mediator.send(new SearchProductsQuery(searchTerm, status, pageable));
}
```

---

## 8. Bloque `idempotency`

Evita que una petición duplicada (retry del cliente, red inestable) ejecute la misma
operación dos veces.

**Problema que resuelve:** en redes inestables o con proxies que reintenten automáticamente,
el mismo request HTTP puede llegar dos veces. Sin idempotencia, se crearían dos órdenes,
dos pagos, etc. Con `idempotency`, el generador produce un filtro que detecta requests
ya procesados y devuelve la misma respuesta.

```yaml
- id: UC-ORD-001
  name: PlaceOrder
  type: command           # solo válido para commands
  idempotency:
    header: Idempotency-Key      # header HTTP que lleva la clave
    ttl: PT24H                   # ISO-8601 duration: durante cuánto tiempo se guarda
    storage: database            # database o redis
```

### Propiedades de `idempotency`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `header` | string | ✅ | Nombre del header HTTP (e.g. `Idempotency-Key`). |
| `ttl` | ISO-8601 duration | ✅ | Tiempo de retención de la clave. Ejemplos: `PT1H`, `P1D`, `PT24H`. |
| `storage` | `database` \| `redis` | ✅ | Dónde almacenar las claves procesadas. |

> **Restricción:** solo válido en use cases de `type: command`.

### Código Java generado

**`PlaceOrderHandler.java`** (fragmento):
```java
@Component
@Transactional
public class PlaceOrderHandler implements CommandHandler<PlaceOrderCommand, UUID> {

    @Override
    public UUID execute(PlaceOrderCommand command) {
        // [G2] idempotency check — derived_from: idempotency.header=Idempotency-Key
        // El handler está envuelto por IdempotencyFilter en el controller
        // ...
    }
}
```

**Controller** (anotación generada):
```java
@Idempotent(header = "Idempotency-Key", ttl = "PT24H", storage = IdempotencyStorage.DATABASE)
@PostMapping("/orders")
public ResponseEntity<?> placeOrder(...) { ... }
```

**Tabla de base de datos generada** (si `storage: database`):
```sql
CREATE TABLE IF NOT EXISTS idempotency_request (
    idempotency_key VARCHAR(255)  NOT NULL,
    operation       VARCHAR(200)  NOT NULL,
    response_body   TEXT,
    http_status     INTEGER       NOT NULL,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ   NOT NULL,
    PRIMARY KEY (idempotency_key, operation)
);
```

---

## 9. Bloque `bulk`

Envuelve un use case existente para procesarlo en batch sobre una lista de ítems.

**Problema que resuelve:** en lugar de llamar al endpoint 1000 veces para activar 1000
productos, el cliente hace una sola llamada con una lista. El generador produce un
handler de bulk que itera y delega en el command handler individual.

```yaml
- id: UC-PRD-030
  name: BulkActivateProducts
  type: command              # solo válido para commands
  bulk:
    itemType: ActivateProduct  # nombre del use case individual (debe existir en este BC)
    maxItems: 500              # límite de ítems por request
    onItemError: continue      # continue: registra el error y sigue | abort: falla todo
```

### Propiedades de `bulk`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `itemType` | PascalCase | ✅ | Nombre del use case individual que procesa cada ítem. Debe ser un command en el mismo BC y no puede ser otro bulk. |
| `maxItems` | integer positivo | no | Límite de ítems por request. |
| `onItemError` | `continue` \| `abort` | no | Qué hacer si un ítem falla. `continue`: registra y sigue. `abort`: falla todo (rollback). |

> **Restricciones:**
> - Solo válido para `type: command`
> - No puede combinarse con `input[]` (el payload son solo los ítems)
> - No puede combinarse con `async`

### Código Java generado

**`BulkActivateProductsCommand.java`:**
```java
public record BulkActivateProductsCommand(
    List<ActivateProductCommand> items
) {}
```

**`BulkActivateProductsHandler.java`:**
```java
@Component
@Transactional
public class BulkActivateProductsHandler
    implements CommandHandler<BulkActivateProductsCommand, BulkResult> {

    private final ActivateProductHandler itemHandler;

    @Override
    public BulkResult execute(BulkActivateProductsCommand command) {
        List<BulkItemResult> results = new ArrayList<>();
        for (ActivateProductCommand item : command.items()) {
            try {
                itemHandler.execute(item);
                results.add(BulkItemResult.success(item.productId()));
            } catch (Exception e) {
                results.add(BulkItemResult.failure(item.productId(), e.getMessage()));
                // onItemError: continue → registra el error y sigue
            }
        }
        return new BulkResult(results);
    }
}
```

---

## 10. Bloque `async`

Convierte un command en una operación asíncrona con seguimiento de estado (job tracking)
o disparo y olvido (fire and forget).

**Problema que resuelve:** algunas operaciones toman más tiempo del que un cliente HTTP
puede esperar (segundos o minutos). Con `async`, el cliente recibe inmediatamente un
`jobId` y puede consultar el estado en un endpoint separado.

```yaml
- id: UC-CAT-050
  name: BulkImportProducts
  type: command
  async:
    mode: jobTracking         # jobTracking o fireAndForget
    statusEndpoint: getJobStatus   # operationId del endpoint de consulta de estado
```

### Propiedades de `async`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `mode` | `jobTracking` \| `fireAndForget` | ✅ | Modo de procesamiento asíncrono. |
| `statusEndpoint` | camelCase (operationId) | no | OperationId del endpoint para consultar el estado del job. Solo para `mode: jobTracking`. |

#### Modo `jobTracking`

El generador produce:
1. Un endpoint que crea el job y devuelve `202 Accepted` con el `jobId`
2. Un endpoint de consulta de estado (si `statusEndpoint` está declarado)
3. Una entidad JPA `AsyncJob` para persistir el estado del job
4. Un `@Async` handler que ejecuta la operación y actualiza el estado

**Código Java generado** — endpoint de inicio:
```java
@PostMapping("/products/bulk-import")
@ResponseStatus(HttpStatus.ACCEPTED)
public AsyncJobResponse bulkImportProducts(
    @RequestBody @Valid BulkImportProductsRequest request) {

    UUID jobId = mediator.send(new BulkImportProductsCommand(request.fileUrl()));
    return new AsyncJobResponse(jobId, "/jobs/" + jobId);
}
```

**Tabla `async_job`** (generada con Flyway):
```sql
CREATE TABLE IF NOT EXISTS async_job (
    id          UUID         PRIMARY KEY,
    type        VARCHAR(200) NOT NULL,
    status      VARCHAR(20)  NOT NULL DEFAULT 'PENDING',  -- PENDING, RUNNING, DONE, FAILED
    input       JSONB,
    result      JSONB,
    error       TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

#### Modo `fireAndForget`

El generador produce el mismo endpoint de inicio, pero sin tabla `async_job`. El handler
se ejecuta en background y no hay forma de consultar el resultado.

```java
@Async
public void execute(BulkImportProductsCommand command) {
    // TODO: implement fire-and-forget logic
    throw new UnsupportedOperationException("Not implemented yet");
}
```

---

## 11. Propiedad `rules`

Lista las reglas de dominio que se evalúan durante la ejecución del use case. Cada
valor es un `id` de una regla declarada en `aggregates[].domainRules`.

```yaml
- id: UC-PRD-004
  name: ActivateProduct
  type: command
  rules:
    - PRD-RULE-001     # statePrecondition: debe estar en DRAFT
    - PRD-RULE-002     # uniqueness: SKU único (puede haberse cambiado antes de activar)
```

El generador produce código ejecutable para cada regla listada (según su tipo). Si la
regla no está en `errors[]`, la build falla:

```
[bc-yaml-reader] domainRule "PRD-RULE-001" errorCode "PRODUCT_CANNOT_BE_ACTIVATED"
not found in errors[].
```

---

## 12. `notFoundError` y `lookups`

### `notFoundError` (simple)

Cuando el use case carga un único agregado por ID y necesita lanzar un error si no existe:

```yaml
- id: UC-PRD-004
  name: ActivateProduct
  type: command
  aggregate: Product
  notFoundError: PRODUCT_NOT_FOUND
  input:
    - name: productId
      type: Uuid
      source: path
      required: true
      loadAggregate: true
```

Genera en el handler:
```java
Product product = productRepository.findById(command.productId())
    .orElseThrow(ProductNotFoundError::new);
```

### `lookups` (múltiples cargas)

Para use cases que cargan varios agregados y necesitan errores distintos por cada uno:

```yaml
- id: UC-ORD-010
  name: AddItemToOrder
  type: command
  lookups:
    - param: orderId
      aggregate: Order
      errorCode: ORDER_NOT_FOUND
    - param: productId
      aggregate: Product
      errorCode: PRODUCT_NOT_FOUND
    - param: itemId
      nestedIn: Order.items      # busca en una colección hija del agregado
      errorCode: ORDER_ITEM_NOT_FOUND
```

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `param` | camelCase | ✅ | Nombre del input que contiene el ID a buscar. Único dentro de `lookups`. |
| `aggregate` | PascalCase | ✅ o `nestedIn` | Agregado a cargar. Exclusivo con `nestedIn`. |
| `nestedIn` | `Aggregate.field` | ✅ o `aggregate` | Para buscar en una colección hija: `Order.items`. |
| `errorCode` | SCREAMING_SNAKE | ✅ | Error a lanzar si no se encuentra. Debe existir en `errors[]`. |
| `description` | texto | no | Solo referencia. |

**Código Java generado:**
```java
Order order = orderRepository.findById(command.orderId())
    .orElseThrow(OrderNotFoundError::new);

Product product = productRepository.findById(command.productId())
    .orElseThrow(ProductNotFoundError::new);

OrderItem item = order.getItems().stream()
    .filter(i -> i.getId().equals(command.itemId()))
    .findFirst()
    .orElseThrow(OrderItemNotFoundError::new);
```

> **`lookups` y `notFoundError` son mutuamente excluyentes.** Si se declaran ambos,
> la build falla.

---

## 13. `fkValidations`

Valida la existencia de entidades referenciadas por el use case en otros repositorios
(foreign key a nivel de dominio).

```yaml
fkValidations:
  - aggregate: Category
    param: categoryId
    error: CATEGORY_NOT_FOUND

  - aggregate: Supplier
    param: supplierId
    bc: suppliers          # BC propietario del repositorio (si es diferente al BC actual)
    error: SUPPLIER_NOT_FOUND
    conditional: categoryId != null   # solo si categoryId fue provisto
```

### Propiedades de `fkValidations`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `aggregate` | PascalCase | ✅ | Agregado cuya existencia se verifica. |
| `param` | camelCase | ✅ | Nombre del input que contiene el ID del agregado a verificar. |
| `error` | SCREAMING_SNAKE | ✅ | Error si el registro no existe. Alias: `notFoundError`. |
| `bc` | kebab-case | no | BC propietario del repositorio. Si se omite, se asume el BC actual. |
| `conditional` | expresión Java | no | La validación solo se ejecuta si esta expresión es `true`. |

**Código Java generado:**
```java
// fkValidation: Category
if (!categoryRepository.existsById(command.categoryId())) {
    throw new CategoryNotFoundError();
}

// fkValidation: Supplier (condicional)
if (command.categoryId() != null) {
    if (!supplierRepository.existsById(command.supplierId())) {
        throw new SupplierNotFoundError();
    }
}
```

---

## 14. Propiedad `validations`

Valida condiciones cruzadas entre campos del input que no pueden expresarse con anotaciones
Jakarta Validation estándar.

**Problema que resuelve:** validaciones como "si `discountType` es `PERCENTAGE`, entonces
`discountValue` debe estar entre 0 y 100" requieren lógica multi-campo que Bean Validation
no soporta directamente.

```yaml
validations:
  - id: VAL-001
    expression: "command.discountValue() <= 100 || !DiscountType.PERCENTAGE.equals(command.discountType())"
    errorCode: INVALID_PERCENTAGE_DISCOUNT
    description: When discount type is PERCENTAGE, value must be between 0 and 100.

  - id: VAL-002
    expression: "command.startDate().isBefore(command.endDate())"
    errorCode: INVALID_DATE_RANGE
    description: Start date must be before end date.
```

### Propiedades de `validations`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `id` | camelCase o string | ✅ | Identificador único dentro del use case. |
| `expression` | expresión Java | ✅ | Condición que debe ser `true` para que la operación sea válida. Se evalúa sobre el objeto `command`. |
| `errorCode` | SCREAMING_SNAKE | ✅ | Error a lanzar si la expresión es `false`. Debe existir en `errors[]`. |
| `description` | texto | no | Solo referencia. |

**Código Java generado** en el handler:
```java
// [G20] cross-field validation VAL-001
if (!(command.discountValue() <= 100 || !DiscountType.PERCENTAGE.equals(command.discountType()))) {
    throw new InvalidPercentageDiscountError();
}

// [G20] cross-field validation VAL-002
if (!(command.startDate().isBefore(command.endDate()))) {
    throw new InvalidDateRangeError();
}
```

---

## 15. Propiedad `emits`

Declara los eventos de dominio que publica el use case. El generador añade la lógica
de publicación al final del handler.

```yaml
- id: UC-PRD-004
  name: ActivateProduct
  type: command
  emits: ProductActivated

  # O múltiples eventos (S22):
  emits:
    - ProductActivated
    - ProductAddedToSearchIndex
```

Los eventos deben estar declarados en `domainEvents.published`. Si no existe la
declaración, la build falla con referencia al evento no encontrado.

**Diferencia con `domainMethods[].emits`:** cuando el método de dominio ya declara
`emits`, el generador emite el evento dentro del método del agregado vía `raise()`. Cuando
el use case también declara `emits`, el generador puede emitir eventos adicionales
directamente desde el handler (sin pasar por el agregado). Se debe evitar la duplicación.

---

## 16. Multi-agregado: `aggregates` + `steps`

Para use cases que orquestan la mutación de múltiples agregados dentro del mismo BC.

**Problema que resuelve:** algunas operaciones de negocio afectan a más de un agregado.
Por ejemplo, "confirmar un pedido" puede actualizar tanto la `Order` como el `Payment`.
Sin este patrón, el handler tendría que cargar ambos manualmente sin una guía de estructura.

```yaml
- id: UC-ORD-020
  name: ConfirmOrderAndPayment
  type: command              # solo commands
  aggregates:
    - Order
    - Payment
  steps:
    - aggregate: Order
      method: confirm
      onFailure:
        compensate:
          aggregate: Order
          method: rollback

    - aggregate: Payment
      method: capture
      onFailure:
        compensate:
          aggregate: Payment
          method: void
```

### Propiedades de `aggregates` (multi-aggregate)

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `aggregates` | lista PascalCase (mínimo 2) | ✅ | Agregados involucrados. Todos deben estar en el mismo BC. |
| `steps` | lista | ✅ | Pasos de ejecución en orden. |

### Propiedades de un `step`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `aggregate` | PascalCase | ✅ | Debe ser uno de los declarados en `aggregates`. |
| `method` | camelCase | ✅ | Debe estar en `aggregates[].domainMethods`. |
| `onFailure` | objeto | no | Acción de compensación si este paso falla. |
| `onFailure.compensate` | objeto | ✅ | Qué ejecutar como compensación. |
| `onFailure.compensate.aggregate` | PascalCase | ✅ | Uno de los declarados en `aggregates`. |
| `onFailure.compensate.method` | camelCase | ✅ | Método de compensación. Debe estar en `domainMethods`. |

> **Restricciones:** no se puede combinar con `bulk`, `async`, ni `aggregate`/`method`.

**Código Java generado:**
```java
@Override
public void execute(ConfirmOrderAndPaymentCommand command) {
    Order order = orderRepository.findById(command.orderId())
        .orElseThrow(OrderNotFoundError::new);
    Payment payment = paymentRepository.findById(command.paymentId())
        .orElseThrow(PaymentNotFoundError::new);

    try {
        order.confirm();
        orderRepository.save(order);
    } catch (Exception e) {
        // onFailure.compensate: Order.rollback
        order.rollback();
        orderRepository.save(order);
        throw e;
    }

    try {
        payment.capture();
        paymentRepository.save(payment);
    } catch (Exception e) {
        // onFailure.compensate: Payment.void
        payment.void_();
        paymentRepository.save(payment);
        // compensate: Order.rollback
        order.rollback();
        orderRepository.save(order);
        throw e;
    }
}
```

---

## 17. Propiedad `implementation`

Controla si el generador produce el método `execute()` completo o solo un scaffold.

| Valor | Descripción |
|---|---|
| `scaffold` | El método `execute()` genera `// TODO` + `throw new UnsupportedOperationException()`. Para use cases con lógica de negocio compleja. |
| `full` | El generador intenta producir implementación completa (para CRUD simple). |
| (ausente) | Equivalente a `full` para operaciones simples; para operaciones complejas el generador emite TODO donde no puede inferir la lógica. |

```yaml
# Use case simple: el generador produce código completo
- id: UC-PRD-010
  name: GetProductById
  type: query
  # implementation no declarado → generado completo

# Use case complejo: el diseñador declara scaffold explícitamente
- id: UC-ORD-001
  name: PlaceOrder
  type: command
  implementation: scaffold
```

**Handler con `implementation: scaffold`:**
```java
@Override
public UUID execute(PlaceOrderCommand command) {
    // TODO: implement business logic — ver orders-flows.md
    throw new UnsupportedOperationException("Not implemented yet");
}
```

**Handler con `implementation: full`** (para un query simple):
```java
@Override
public ProductDetail execute(GetProductByIdQuery query) {
    Product product = productRepository.findById(query.productId())
        .orElseThrow(ProductNotFoundError::new);
    return mapper.toProductDetail(product);
}
```

---

## 18. Ejemplos completos

### Ejemplo 1: Command completo con todas las capacidades

```yaml
- id: UC-PRD-001
  name: CreateProduct
  type: command
  actor: admin
  description: Creates a new product in DRAFT state with initial price and category assignment.
  trigger:
    kind: http
    operationId: createProduct
  aggregate: Product
  method: create
  input:
    - name: sku
      type: String(50)
      source: body
      required: true
    - name: name
      type: String(200)
      source: body
      required: true
    - name: priceAmount
      type: Decimal
      precision: 19
      scale: 4
      source: body
      required: true
    - name: priceCurrency
      type: String(3)
      source: body
      required: true
    - name: categoryId
      type: Uuid
      source: body
      required: true
    - name: currentUserId
      type: Uuid
      source: authContext
      required: true
  fkValidations:
    - aggregate: Category
      param: categoryId
      error: CATEGORY_NOT_FOUND
  rules:
    - PRD-RULE-002   # uniqueness: SKU
    - PRD-RULE-004   # crossAggregateConstraint: category must be ACTIVE
  validations:
    - id: VAL-SKU-FORMAT
      expression: "command.sku().matches(\"^[A-Z0-9\\\\-]+$\")"
      errorCode: INVALID_SKU_FORMAT
  emits: ProductCreated
  authorization:
    rolesAnyOf:
      - ROLE_ADMIN
      - ROLE_CATALOG_MANAGER
  idempotency:
    header: Idempotency-Key
    ttl: PT1H
    storage: database
  implementation: scaffold
```

### Ejemplo 2: Query paginado con búsqueda y filtros

```yaml
- id: UC-PRD-012
  name: SearchProducts
  type: query
  actor: customer
  trigger:
    kind: http
    operationId: searchProducts
  aggregate: Product
  input:
    - name: searchTerm
      type: SearchText
      source: query
      required: false
      fields: [name, description, sku]
    - name: status
      type: ProductStatus
      source: query
      required: false
    - name: priceRange
      type: Range[Decimal]
      source: query
      required: false
    - name: categoryId
      type: Uuid
      source: query
      required: false
  returns: ProductSummary
  pagination:
    defaultSize: 20
    maxSize: 100
    sortable: [name, price, createdAt]
    defaultSort:
      field: createdAt
      direction: DESC
```

### Ejemplo 3: Command activado por evento

```yaml
- id: UC-INV-010
  name: CreateStockItem
  type: command
  trigger:
    kind: event
    consumes: ProductActivated
    fromBc: catalog
    channel: catalog.product.activated
  aggregate: StockItem
  method: create
  input:
    - name: productId
      type: Uuid
      source: body
      required: true
    - name: initialQuantity
      type: Integer
      source: body
      required: false
      default: 0
  emits: StockItemCreated
  implementation: scaffold
```
