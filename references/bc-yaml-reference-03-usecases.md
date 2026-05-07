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
public void createProduct(
    @Valid @RequestBody CreateProductCommand command) {

    log.info("createProduct");
    useCaseMediator.dispatch(command);
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
| `type` | tipo canónico | ✅ | Tipo del parámetro. Ver tabla de tipos canónicos a continuación. |
| `source` | enum | ✅ | De dónde proviene el valor. Ver tabla siguiente. |
| `required` | boolean | no | Si `true`: `@NotNull` en el command/query. Default: `false`. |
| `default` | valor | no | Valor por defecto cuando no se provee. Solo válido para `source: query`. |
| `max` | integer | no | Valor máximo. Solo para `Integer`, `Long`, `Decimal`. Genera `@Max` en el DTO. |
| `loadAggregate` | boolean | no | Si `true`, el generador emite `findById(command.{name}()).orElseThrow(notFoundError::new)` al inicio del handler. |
| `headerName` | string | ✅ si `source: header` | Nombre del header HTTP (e.g. `X-Tenant-Id`). |
| `partName` | string | no | Nombre de la parte multipart. Solo si `source: multipart`. |
| `maxSize` | `{N}{B\|KB\|MB\|GB}` | no | Tamaño máximo del archivo. Solo si `source: multipart`. |
| `contentTypes` | lista MIME | no | MIME types aceptados. Solo si `source: multipart`. El generador no valida los valores: cualquier string MIME es aceptado (p. ej. `image/png`, `image/jpeg`, `application/pdf`). Se genera en el controller un guard `Set.of(...).contains(file.getContentType())` con los tipos declarados. |
| `fields` | lista camelCase | ✅ si `type: SearchText` | Propiedades del agregado sobre las que se aplica la búsqueda LIKE. Deben existir en el agregado. |

### Tipos canónicos permitidos en `input[].type`

| Tipo YAML | Java generado | Notas |
|---|---|---|
| `Uuid` | `String` (command) / `UUID` (handler) | En commands HTTP se serializa como `String`; el handler convierte con `UUID.fromString`. |
| `String` | `String` | — |
| `String(n)` | `String` + `@Size(max = n)` | Limita longitud. |
| `Text` | `String` | Sin límite de longitud; equivalente a `String` para inputs. |
| `Integer` | `Integer` | — |
| `Long` | `Long` | — |
| `Decimal` | `BigDecimal` | Admite `precision` y `scale` opcionales. |
| `Boolean` | `Boolean` | — |
| `Date` | `LocalDate` | — |
| `DateTime` | `Instant` | — |
| `Duration` | `Duration` | — |
| `Email` | `String` + `@Email` | — |
| `Url` | `URI` | — |
| `Money` | `Money` (value object) | `@Valid @Embedded`. |
| `File` | `MultipartFile` | Solo válido con `source: multipart`. |
| `SearchText` | `String` | Marcador semántico: exige `fields[]` y genera un Specification LIKE en el repositorio. Se transmite como `String` en el record. |
| `Range[T]` | `Range<T>` | Rango numérico/temporal. `T` debe ser un tipo canónico simple (p. ej. `Range[Decimal]`, `Range[Integer]`, `Range[Date]`). |
| `List[T]` | `List<T>` | Lista de valores del tipo `T`. |
| `Enum<X>` | `X` (enum de dominio) | Referencia a un enum declarado en `enums[]`. |

> **Tipos prohibidos** — el generador falla si se usan: `string`, `int`, `number`, `float`, `bool`, `date` (minúscula), `timestamp`, `any`, `object`, `bigint`, o `varchar(n)`.

### Valores de `source`

| Valor | Genera en el controller | Genera en el command/query |
|---|---|---|
| `body` | `@RequestBody @Valid {Name}Command command` | Campo del record |
| `path` | `@PathVariable String {name}` | Campo del record (String; el handler convierte con `UUID.fromString`) |
| `query` | `@RequestParam(required=false) String status` | Campo del record |
| `authContext` | **Ninguno** — no se extrae en el controller | **No se incluye** en el command record; se inyecta dentro del handler desde `SecurityContextHolder` |
| `header` | `@RequestHeader("X-Tenant-Id") String tenantId` | Campo del record |
| `multipart` | `@RequestPart("file") MultipartFile image` | Campo del record (tipo `MultipartFile`) |

> **Restricción:** `source: multipart` y `source: body` son mutuamente excluyentes en
> el mismo use case (Spring no puede mezclar `@RequestPart` y `@RequestBody`).

### Código Java generado — command y handler

Para el use case `CreateProduct`:

**`CreateProductCommand.java`:**
```java
package com.canastaShop.catalog.application.commands;

import java.math.BigDecimal;

// Nota: los campos Uuid se mapean a String en commands HTTP;
// el handler convierte con UUID.fromString(command.categoryId()).
// Los campos con source: authContext no aparecen en el record.
public record CreateProductCommand(
    String sku,
    String name,
    BigDecimal priceAmount,
    String priceCurrency,
    String categoryId
) implements Command {}
```

**`CreateProductCommandHandler.java`:**
```java
@ApplicationComponent
public class CreateProductCommandHandler implements CommandHandler<CreateProductCommand> {

    private final ProductRepository productRepository;
    private final CategoryRepository categoryRepository;

    @Override
    @Transactional
    @LogExceptions
    public void handle(CreateProductCommand command) {
        // fkValidations
        if (categoryRepository.findById(UUID.fromString(command.categoryId())).isEmpty()) {
            throw new ProductCategoryNotFoundError();
        }

        // domainRule(PRD-RULE-002): uniqueness PRE-CHECK
        if (productRepository.findBySku(command.sku()).isPresent()) {
            throw new ProductSkuAlreadyExistsError();
        }

        // domainRule(PRD-RULE-004): crossAggregateConstraint
        // TODO: implement business logic — ver catalog-flows.md

        // invoke domain method
        Product product = Product.create(command.sku(), command.name(),
            new Money(command.priceAmount(), command.priceCurrency()),
            UUID.fromString(command.categoryId()));

        productRepository.save(product);
    }
}
```

### `source: authContext`

**Problema que resuelve:** el handler necesita saber quién ejecuta la operación (para
auditoría, ownership, o lógica de negocio) pero no quiere depender del contexto de
seguridad directamente. Con `source: authContext`, el campo se **excluye del command record** y
se inyecta dentro del handler desde `SecurityContextHolder`.

```yaml
input:
  - name: currentUserId
    type: Uuid
    source: authContext
    required: true
```

> **Comportamiento real:**
> - El campo `authContext` **NO aparece en el controller** ni en el constructor del command record.
> - En handlers con `implementation: scaffold`, el generador emite un comentario `// TODO (authContext): inject UUID currentUserId from SecurityContextHolder.getContext().getAuthentication()`.
> - En handlers con `implementation: full` (method: create), el generador resuelve el valor directamente en el handler:

```java
// En el handler (NO en el controller):
UUID currentUserId = UUID.fromString(
    SecurityContextHolder.getContext().getAuthentication().getName());
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
public PagedResponse<ProductSummary> searchProducts(
    @RequestParam(required = false) String searchTerm,
    @RequestParam(required = false) BigDecimal priceRangeMin,
    @RequestParam(required = false) BigDecimal priceRangeMax) {

    log.info("searchProducts");
    return useCaseMediator.dispatch(new SearchProductsQuery(searchTerm, new Range<>(priceRangeMin, priceRangeMax)));
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

# Query paginada — Page[T] es obligatorio para que el generador produzca PagedResponse<T>
- id: UC-PRD-012
  type: query
  returns: Page[ProductSummary]   # Page[T] → PagedResponse<T>; combinar con bloque pagination

# Query que devuelve un resultado opcional (200 si existe, 404 si no)
- id: UC-PRD-013
  type: query
  returns: Optional[ProductDetail]

# Query que descarga un archivo binario
- id: UC-PRD-020
  type: query
  returns: BinaryStream

# Comando sin retorno (default: void)
- id: UC-PRD-001
  type: command
  # sin returns → void; command record implementa Command

# Comando que devuelve el ID del nuevo recurso
- id: UC-PRD-002
  type: command
  returns: Uuid             # command record implementa ReturningCommand<UUID>

# Comando que devuelve el precio calculado
- id: UC-PRD-003
  type: command
  returns: Decimal          # command record implementa ReturningCommand<BigDecimal>
```

| Valor | Java generado | Notas |
|---|---|---|
| Nombre de projection / VO | `T` | Se usa el nombre tal cual como clase Java. Aplica en queries y commands. |
| Tipo canónico escalar | Ver tabla abajo | `Uuid`, `Decimal`, `Integer`, etc. El generador convierte al tipo Java correcto e importa el stdlib correspondiente. Aplica en queries y commands. |
| `List[T]` | `List<T>` | Lista completa, sin paginación. |
| `Page[T]` | `PagedResponse<T>` | El generador detecta `returns.startsWith("Page[")`. Combinar con el bloque `pagination` para controlar `defaultSize`, `maxSize` y `sortable`. |
| `Optional[T]` | `Optional<T>` en handler → `ResponseEntity<T>` en controller | Controller responde 200 si el handler devuelve valor, 404 si `Optional.empty()`. Solo válido en queries. |
| `BinaryStream` | `ResponseEntity<Resource>` | Solo válido en queries. El controller genera `application/octet-stream`. |
| (commands sin `returns`) | `void` | Command record implementa `Command`; handler implementa `CommandHandler<C>`. |
| (commands con `returns: T`) | `T` | Command record implementa `ReturningCommand<T>`; handler implementa `ReturningCommandHandler<C, T>`. Cualquier tipo canónico escalar o nombre de DTO/projection es válido. `Uuid` es la convención habitual para retornar el ID del recurso creado. |

### Tipos canónicos escalares como `returns`

Cuando `returns` es un tipo canónico escalar el generador produce el tipo Java correcto e incluye el import del stdlib. No se genera ningún import de DTO del BC.

| Tipo YAML | Java generado | Import |
|---|---|---|
| `Uuid` | `UUID` | `java.util.UUID` |
| `Integer` | `Integer` | — |
| `Long` | `Long` | — |
| `Decimal` | `BigDecimal` | `java.math.BigDecimal` |
| `Boolean` | `Boolean` | — |
| `Date` | `LocalDate` | `java.time.LocalDate` |
| `DateTime` | `Instant` | `java.time.Instant` |
| `Duration` | `Duration` | `java.time.Duration` |
| `String` / `Text` / `Email` | `String` | — |
| `Url` | `URI` | `java.net.URI` |

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
  rolesAnyOf:            # RBAC clásico — el usuario debe tener al menos uno de estos roles
    - ROLE_ADMIN
    - ROLE_CATALOG_MANAGER

  permissionsAnyOf:      # RBAC granular — el usuario debe tener al menos uno de estos permisos
    - catalog:create
    - catalog:write

  scopesAnyOf:           # OAuth2 Scopes — el token debe tener al menos uno de estos scopes
    - catalog:write      # escribir el nombre limpio; el generador añade el prefijo SCOPE_ automáticamente

  ownership:
    field: ownerId           # propiedad del agregado a comparar
    claim: userId            # claim del JWT con el ID del usuario actual
    allowRoleBypass:
      - ROLE_ADMIN           # roles que pueden saltarse la verificación de ownership
```

Cuando se declaran varios de los tres campos de `@PreAuthorize`, se combinan con **AND**.
El orden en la expresión generada es siempre: `scopesAnyOf` → `rolesAnyOf` → `permissionsAnyOf`.

### Propiedades de `authorization`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `rolesAnyOf` | lista strings | no | El usuario debe tener **al menos uno** de estos roles. Los nombres con o sin prefijo `ROLE_` son aceptados; el generador elimina el prefijo automáticamente al construir `hasAnyRole(...)`. |
| `permissionsAnyOf` | lista strings | no | El usuario/token debe tener **al menos uno** de estos permisos granulares (ej. `products:create`). Genera `hasAnyAuthority(...)`. No se acepta el prefijo `ROLE_` en este campo. |
| `scopesAnyOf` | lista strings | no | El **token** debe tener **al menos uno** de estos OAuth2 scopes. Escribe los nombres sin prefijo (ej. `catalog:write`); el generador añade `SCOPE_` automáticamente al generar `hasAnyAuthority('SCOPE_...')`. |
| `ownership` | objeto | no | Verifica en tiempo de ejecución que el usuario actual sea el dueño del recurso. |
| `ownership.field` | camelCase | ✅ | Nombre de la **propiedad** del agregado que contiene el ID del propietario. El generador construye el getter automáticamente: `field: ownerId` → `aggregate.getOwnerId()`. |
| `ownership.claim` | string | ✅ | Nombre del claim en el JWT del usuario autenticado que contiene su ID. El generador llama `SecurityContextUtil.currentUserClaim("claim")`. Valor típico: `sub` (OIDC estándar) o un claim personalizado como `userId`. |
| `ownership.allowRoleBypass` | lista strings | no | Roles que quedan exentos de la verificación de ownership. Un usuario con cualquiera de estos roles puede operar sobre recursos que no son suyos. Sin este campo, la guarda aplica a **todos** los usuarios sin excepción. |

### Cuándo usar cada campo

| Campo | Responde a | Caso típico |
|---|---|---|
| `rolesAnyOf` | ¿Qué función tiene el **usuario**? | Sistemas internos: `ROLE_ADMIN`, `ROLE_OPERATOR` |
| `permissionsAnyOf` | ¿Qué operación puede hacer el **usuario**? | RBAC maduro: `products:delete`, `orders:cancel` |
| `scopesAnyOf` | ¿Qué puede hacer este **token/cliente**? | M2M, APIs públicas, multi-tenant: `catalog:write` |
| `ownership` | ¿Es el **usuario** el dueño del recurso? | Portal de clientes: solo ver/editar su propia cuenta |

### Código Java generado

**Con solo `rolesAnyOf`:**
```yaml
authorization:
  rolesAnyOf:
    - ROLE_ADMIN
    - ROLE_CATALOG_MANAGER
```
```java
@PreAuthorize("hasAnyRole('ADMIN', 'CATALOG_MANAGER')")
@PostMapping("/products")
public void createProduct(...) { ... }
```

**Con solo `permissionsAnyOf`:**
```yaml
authorization:
  permissionsAnyOf:
    - products:create
    - products:write
```
```java
@PreAuthorize("hasAnyAuthority('products:create', 'products:write')")
@PostMapping("/products")
public void createProduct(...) { ... }
```

**Con solo `scopesAnyOf`:**
```yaml
authorization:
  scopesAnyOf:
    - catalog:write
```
```java
// El generador añade el prefijo SCOPE_ automáticamente:
@PreAuthorize("hasAnyAuthority('SCOPE_catalog:write')")
@PostMapping("/items")
public void createItem(...) { ... }
```

**Combinación — `scopesAnyOf` + `rolesAnyOf`:**
```yaml
authorization:
  rolesAnyOf:
    - ROLE_MANAGER
  scopesAnyOf:
    - catalog:write
```
```java
// Orden: scopes → roles → permissions, unidos con and:
@PreAuthorize("hasAnyAuthority('SCOPE_catalog:write') and hasAnyRole('MANAGER')")
@PutMapping("/items/{itemId}")
public void updateItem(...) { ... }
```

**Combinación — los tres campos:**
```yaml
authorization:
  rolesAnyOf:
    - ROLE_ADMIN
  scopesAnyOf:
    - catalog:admin
  permissionsAnyOf:
    - catalog:archive
```
```java
@PreAuthorize("hasAnyAuthority('SCOPE_catalog:admin') and hasAnyRole('ADMIN') and hasAnyAuthority('catalog:archive')")
@PostMapping("/items/{itemId}/archive")
public void archiveItem(...) { ... }
```

**Con `ownership`:**

> `ownership` **no genera `@PreAuthorize`**. Genera una guarda imperativa en el
> **handler**, ejecutada después de cargar el agregado. Requiere que algún input del
> use case declare `loadAggregate: true`; sin él, el agregado no estará disponible
> para la comparación.

YAML — sin `allowRoleBypass`:
```yaml
authorization:
  ownership:
    field: ownerId
    claim: userId
```
```java
// [G3] Ownership guard — derived_from: useCases[UC-PRD-004].authorization
if (!Objects.equals(String.valueOf(product.getOwnerId()), SecurityContextUtil.currentUserClaim("userId"))) {
    throw new ForbiddenException();
}
```

YAML — con `allowRoleBypass`:
```yaml
authorization:
  rolesAnyOf:
    - ROLE_CUSTOMER
    - ROLE_ADMIN
  ownership:
    field: ownerId
    claim: userId
    allowRoleBypass:
      - ROLE_ADMIN
```
```java
// En el controller (de rolesAnyOf):
@PreAuthorize("hasAnyRole('CUSTOMER', 'ADMIN')")

// En el handler, tras cargar el agregado (de ownership):
// [G3] Ownership guard — derived_from: useCases[UC-PRD-004].authorization
if (!Objects.equals(String.valueOf(product.getOwnerId()), SecurityContextUtil.currentUserClaim("userId"))
        && !SecurityContextUtil.hasAnyRole("ADMIN")) {
    throw new ForbiddenException();
}
```

La condición se lee: lanza `ForbiddenException` si el usuario **no** es el dueño del
recurso **Y** tampoco tiene uno de los roles de bypass. Un `ROLE_ADMIN` puede operar
sobre recursos que no son suyos; un `ROLE_CUSTOMER` solo puede operar sobre los suyos.

La clase `SecurityContextUtil` (generada siempre en
`shared/infrastructure/security/SecurityContextUtil.java`) provee los dos métodos que
usa la guarda:

```java
// Lee un claim del JWT del principal actual; devuelve null si no existe
public static String currentUserClaim(String claim) { ... }

// Verifica si el usuario tiene alguno de los roles indicados (sin prefijo ROLE_)
public static boolean hasAnyRole(String... roles) { ... }
```

### Cómo funciona `JwtAuthConverter`

El generador produce un `JwtAuthConverter` que extrae **roles**, **scopes** y
**permisos granulares** del JWT en una sola colección de `GrantedAuthority`.
Esto permite que las cuatro estrategias coexistan en el mismo proyecto:

- Roles del token (ej. `realm_access.roles` en Keycloak) → `GrantedAuthority("ROLE_admin")`
- Scopes del token (claim `scope`, espacio-separado) → `GrantedAuthority("SCOPE_catalog:write")`
- Permisos granulares (claim `permissions`, array) → `GrantedAuthority("products:create")`
- Ownership: no usa `GrantedAuthority` — compara el claim del JWT contra un campo del agregado en tiempo de ejecución

```java
private Collection<GrantedAuthority> extractAuthorities(Jwt jwt) {
    List<GrantedAuthority> authorities = new ArrayList<>(extractRoles(jwt));
    authorities.addAll(extractScopes(jwt));
    authorities.addAll(extractPermissions(jwt));   // claim "permissions" → sin prefijo
    return authorities;
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
  returns: Page[ProductSummary]   # obligatorio para PagedResponse<T>; el bloque pagination controla el comportamiento
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

> **Cómo funciona la paginación:** `returns: Page[T]` activa `PagedResponse<T>` como tipo de retorno. El bloque `pagination` añade `page/size/sortBy/sortDirection` al Query record, genera los `@RequestParam` correspondientes en el controller y emite el guard de whitelist para `sortBy`. Sin `returns: Page[T]`, el bloque `pagination` añade los campos pero el tipo de retorno no cambia.

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
    int page,           // ← generado automáticamente por el generador cuando pagination está declarado
    int size,
    String sortBy,
    String sortDirection
) {}
```

**Controller:**
```java
@GetMapping("/products")
public PagedResponse<ProductSummary> searchProducts(
    @RequestParam(required = false) String searchTerm,
    @RequestParam(required = false) ProductStatus status,
    @RequestParam(defaultValue = "0") int page,
    @RequestParam(defaultValue = "20") int size,
    @RequestParam(defaultValue = "createdAt") String sortBy,
    @RequestParam(defaultValue = "DESC") String sortDirection) {

    log.info("searchProducts");
    // [G7] Sortable whitelist guard
    if (!java.util.Set.of("name", "price", "createdAt").contains(sortBy)) {
        throw new BadRequestException("sortBy must be one of: name, price, createdAt");
    }
    return useCaseMediator.dispatch(new SearchProductsQuery(searchTerm, status, page, size, sortBy, sortDirection));
}
```

---

## 8. Bloque `idempotency`

Evita que una petición duplicada (retry del cliente, red inestable) ejecute la misma
operación dos veces.

**Problema que resuelve:** en redes inestables o con proxies que reintenten automáticamente,
el mismo request HTTP puede llegar dos veces. Sin idempotencia, se crearían dos órdenes,
dos pagos, etc. Con `idempotency`, el generador produce un filtro que detecta requests
ya procesados y devuelve la misma respuesta. El protocolo de tres estados elimina además
la condición de carrera entre retries concurrentes: un segundo request idéntico en vuelo
recibe `409 Conflict` en lugar de ejecutarse dos veces.

```yaml
- id: UC-ORD-001
  name: PlaceOrder
  type: command           # solo válido para commands
  idempotency:
    header: Idempotency-Key      # header HTTP que lleva la clave
    ttl: PT24H                   # ISO-8601 duration: durante cuánto tiempo se guarda
    storage: cache               # único valor válido: cache
```

### Propiedades de `idempotency`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `header` | string | ✅ | Nombre del header HTTP (e.g. `Idempotency-Key`). |
| `ttl` | ISO-8601 duration | ✅ | Tiempo de retención de la clave. Ejemplos: `PT1H`, `P1D`, `PT24H`. |
| `storage` | `cache` | ✅ | Siempre `cache`. El proveedor concreto (Redis o Valkey) se configura en `dsl-springboot.json`. Ver nota de migración abajo. |

> **Restricción:** solo válido en use cases de `type: command`.

> **`storage` — valores válidos:**
> Solo se acepta `storage: cache`. Los valores `database` y `redis` han sido eliminados
> y provocan un error de build con indicación de migración:
> ```
> [bc-yaml-reader] idempotency.storage "database" ya no es soportado.
> Usa 'cache'. El provider concreto se configura en dsl-springboot.json con cacheProvider.
> ```

### Configuración del proveedor de caché

El proveedor concreto **no se declara en el YAML del BC**, sino en `dsl-springboot.json`
mediante la propiedad `cacheProvider`:

```json
{
  "groupId": "com.example",
  "javaVersion": "21",
  "springBootVersion": "3.4.5",
  "database": "postgresql",
  "broker": "none",
  "authProvider": "none",
  "cacheProvider": "redis"
}
```

| Valor | Descripción |
|---|---|
| `redis` | Redis 7+. Usa `spring-boot-starter-data-redis`. |
| `valkey` | Valkey 8+. Usa la misma dependencia Spring (`spring-boot-starter-data-redis`). |

Si algún use case declara `idempotency` pero `cacheProvider` no está configurado en
`dsl-springboot.json`, la build falla con un mensaje claro.

### Protocolo de tres estados

El generador produce un filtro (`IdempotencyFilter`) con el siguiente protocolo:

| Estado al consultar | Acción |
|---|---|
| `ABSENT` + `claim()` gana | Ejecuta el handler; en éxito (2xx) → `complete()`; en error → `release()` |
| `ABSENT` + `claim()` pierde | `409 Conflict` (otro nodo/hilo ganó la carrera) |
| `PENDING` | `409 Conflict` (mismo request en vuelo) |
| `COMPLETE` | Devuelve la respuesta almacenada (replay) |

Esto garantiza exactamente-una-ejecución incluso bajo retries concurrentes.

### Código Java generado

**Controller** (anotación generada):
```java
@Idempotent(header = "Idempotency-Key", ttl = "PT24H")
@PostMapping("/orders")
public void placeOrder(...) { ... }
```

**`IdempotencyStore.java`** — interfaz generada en `shared/infrastructure/web/`:
```java
public interface IdempotencyStore {

    enum State { ABSENT, PENDING, COMPLETE }

    record FindResult(State state, StoredResponse response) {}
    record StoredResponse(int status, byte[] body, String contentType) {}

    FindResult find(String key);
    boolean claim(String key, Duration ttl);
    void complete(String key, String hash, StoredResponse response, Duration ttl);
    void release(String key);
}
```

**`RedisIdempotencyStore.java`** — adaptador generado en `shared/infrastructure/web/`:
```java
@Component
public class RedisIdempotencyStore implements IdempotencyStore {

    private static final String PREFIX = "idempotency:";

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    // claim() usa SET NX — atomic: gana quien llega primero
    @Override
    public boolean claim(String key, Duration ttl) {
        return Boolean.TRUE.equals(
            redis.opsForValue().setIfAbsent(PREFIX + key,
                "{\"state\":\"PENDING\"}", ttl.getSeconds(), TimeUnit.SECONDS));
    }

    // complete() sobreescribe con la respuesta final serializada
    @Override
    public void complete(String key, String hash, StoredResponse response, Duration ttl) { ... }

    // release() elimina la clave para que el cliente pueda reintentar
    @Override
    public void release(String key) {
        redis.delete(PREFIX + key);
    }
}
```

**Parámetros Redis generados** — `parameters/{profile}/redis.yaml`:
```yaml
# local
spring:
  data:
    redis:
      host: localhost
      port: 6379

# develop / test
spring:
  data:
    redis:
      host: ${REDIS_HOST:localhost}
      port: ${REDIS_PORT:6379}
      password: ${REDIS_PASSWORD:}

# production
spring:
  data:
    redis:
      host: ${REDIS_HOST}       # obligatorio en producción
      password: ${REDIS_PASSWORD}
      ssl:
        enabled: ${REDIS_SSL_ENABLED:true}
```

**Docker Compose** — servicio Redis añadido automáticamente cuando existe al menos
un use case con `idempotency`:
```yaml
cache:
  image: redis:7-alpine         # o valkey/valkey:8-alpine si cacheProvider: valkey
  container_name: my-system-cache
  ports:
    - "6379:6379"
  networks:
    - my-system-network
```

**`build.gradle`** — dependencia añadida automáticamente:
```groovy
implementation 'org.springframework.boot:spring-boot-starter-data-redis'
```

> **Sin migración Flyway:** la idempotencia basada en caché no genera ninguna tabla
> SQL ni migración Flyway. Todo el estado se almacena en Redis/Valkey con TTL nativo.

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
    @Valid @NotEmpty @Size(max = 500) List<ActivateProductCommand> items
) implements ReturningCommand<BulkResult> {
}
```

**`BulkActivateProductsCommandHandler.java`:**
```java
@ApplicationComponent
public class BulkActivateProductsCommandHandler
    implements ReturningCommandHandler<BulkActivateProductsCommand, BulkResult> {

    private final UseCaseMediator useCaseMediator;

    public BulkActivateProductsCommandHandler(@Lazy UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    @Override
    @Transactional
    @LogExceptions
    public BulkResult handle(BulkActivateProductsCommand command) {
        List<ActivateProductCommand> items = command.items();
        List<BulkResult.BulkError> errors = new ArrayList<>();
        int successCount = 0;
        for (int i = 0; i < items.size(); i++) {
            try {
                useCaseMediator.dispatch(items.get(i));
                successCount++;
            } catch (DomainException ex) {
                errors.add(new BulkResult.BulkError(i, ex.getClass().getSimpleName(), ex.getMessage()));
                // onItemError: continue → registra el error y sigue
            }
        }
        return new BulkResult(successCount, errors);
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
1. Un endpoint que crea el job y devuelve `202 Accepted` con el `jobId` y la URI de estado
2. Un handler que persiste una fila `PENDING` en `async_job` y retorna `JobReference(jobId)`
3. Una entidad JPA `AsyncJobJpa` en el módulo `shared` (compartida por todos los BCs)
4. Un TODO para que el desarrollador implemente el worker que procesa los jobs

**Código Java generado** — endpoint de inicio:
```java
@PostMapping("/products/bulk-import")
public ResponseEntity<JobReference> bulkImportProducts(
    @Valid @RequestBody BulkImportProductsCommand command) {

    log.info("bulkImportProducts");
    JobReference reference = useCaseMediator.dispatch(command);
    URI location = URI.create("/jobs/" + reference.jobId());
    return ResponseEntity.accepted().location(location).body(reference);
}
```

**Handler generado:**
```java
@Override
@Transactional
@LogExceptions
public JobReference handle(BulkImportProductsCommand command) {
    // [G10] Persist a PENDING job row; the actual work is performed by
    // a worker (out of scope for the generator).
    UUID jobId = UUID.randomUUID();
    Instant now = Instant.now();
    AsyncJobJpa job = AsyncJobJpa.builder()
            .id(jobId)
            .type("BulkImportProducts")
            .status(AsyncJobStatus.PENDING)
            .createdAt(now)
            .updatedAt(now)
            .build();
    asyncJobRepository.save(job);
    // TODO useCase(UC-CAT-050, async): implement worker that picks up
    //      PENDING async_job rows of type="BulkImportProducts", transitions
    //      them to RUNNING/SUCCEEDED/FAILED and writes the result.
    return new JobReference(jobId);
}
```

**Tabla `async_job`** (generada con Flyway, migration `V4__async_job.sql`):
```sql
CREATE TABLE IF NOT EXISTS async_job (
    id          UUID          NOT NULL PRIMARY KEY,
    type        VARCHAR(128)  NOT NULL,
    status      VARCHAR(16)   NOT NULL,
    payload     BYTEA,
    result      BYTEA,
    created_at  TIMESTAMP     NOT NULL,
    updated_at  TIMESTAMP     NOT NULL
);
```

#### Modo `fireAndForget`

El generador produce el mismo endpoint de inicio, pero sin tabla `async_job`. El handler
genera un TODO para que el desarrollador implemente el offload asincrónico (via `@Async`,
mensajero, etc.). El controller responde `202 Accepted` en cuanto el método retorna.

```java
@Override
@Transactional
@LogExceptions
public void handle(BulkImportProductsCommand command) {
    // TODO useCase(UC-CAT-050, async): offload the work to an @Async
    //      method, a Spring @Scheduled job, or a message-broker
    //      consumer. The controller responds 202 Accepted as soon as
    //      this method returns.
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
// El campo es String en el command record (Uuid se mapea a String en commands HTTP):
Product product = productRepository.findById(UUID.fromString(command.productId()))
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
// Lookup primario (el que tiene loadAggregate:true o el primero de lookups[]):
Order order = orderRepository.findById(UUID.fromString(command.orderId()))
    .orElseThrow(OrderNotFoundError::new);

// Lookups adicionales — se generan como TODO enriquecido con la clase exacta:
// TODO useCase(UC-ORD-010, lookup:productId): productRepository.findById(UUID.fromString(command.productId())).orElseThrow(ProductNotFoundError::new);
// TODO useCase(UC-ORD-010, lookup:itemId): locate the Order.items entry matching command.itemId() and throw new OrderItemNotFoundError() if missing.
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
| `conditional` | expresión Java | no | **Declarado en el schema YAML pero no implementado por el generador.** El campo es aceptado sin error pero no genera ningún `if` condicional en el handler. |

**Código Java generado:**
```java
// fkValidation mismo BC — usa findById().isEmpty()
if (categoryRepository.findById(UUID.fromString(command.categoryId())).isEmpty()) {
    throw new CategoryNotFoundError();
}

// fkValidation cross-BC sin local read model — usa ServicePort.exists{Aggregate}(UUID)
if (!suppliersServicePort.existsSupplier(UUID.fromString(command.supplierId()))) {
    throw new SupplierNotFoundError();
}
// Nota: el campo `conditional` no genera un if-guard. El validador se emite
// siempre, independientemente de la expresión declarada en el YAML.
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
@Transactional
@LogExceptions
public void handle(ConfirmOrderAndPaymentCommand command) {
    Order order = orderRepository.findById(UUID.fromString(command.orderId()))
        .orElseThrow(OrderNotFoundError::new);
    Payment payment = paymentRepository.findById(UUID.fromString(command.paymentId()))
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
| `scaffold` | El método `handle()` genera `// TODO` + `throw new UnsupportedOperationException()`. Para use cases con lógica de negocio compleja. |
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
@Transactional
@LogExceptions
public void handle(PlaceOrderCommand command) {
    // TODO: implement business logic — ver orders-flows.md
    throw new UnsupportedOperationException("Not implemented yet");
}
```

**Handler con `implementation: full`** (para un query simple):
```java
@Override
@Transactional
@LogExceptions
public ProductDetail handle(GetProductByIdQuery query) {
    Product product = productRepository.findById(UUID.fromString(query.productId()))
        .orElseThrow(ProductNotFoundError::new);
    return productApplicationMapper.toProductDetail(product);
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
