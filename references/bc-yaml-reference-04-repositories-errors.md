# Referencia de `{bc}.yaml` — Parte 4: Repositories y Errors

---

## Tabla de contenidos

1. [Sección `repositories`](#1-sección-repositories)
   - 1.1 [Estructura base](#11-estructura-base)
   - 1.2 [Métodos de query (`queryMethods`)](#12-métodos-de-query-querymethods)
   - 1.3 [Métodos personalizados (`methods`)](#13-métodos-personalizados-methods)
   - 1.4 [Operaciones en bulk (`bulkOperations`)](#14-operaciones-en-bulk-bulkoperations)
   - 1.5 [Derivación automática (`autoDerive`)](#15-derivación-automática-autoderive)
2. [Sección `errors`](#2-sección-errors)
   - 2.1 [Propiedades base](#21-propiedades-base)
   - 2.2 [httpStatus — valores disponibles](#22-httpstatus--valores-disponibles)
   - 2.3 [Personalización con `errorType`](#23-personalización-con-errortype)
   - 2.4 [Errores parametrizados: `messageTemplate` y `args`](#24-errores-parametrizados-messagetemplate-y-args)
   - 2.5 [Encadenamiento con `chainable`](#25-encadenamiento-con-chainable)
   - 2.6 [Taxonomía: `kind` y `triggeredBy`](#26-taxonomía-kind-y-triggeredby)
   - 2.7 [Control de advertencias: `usedFor`](#27-control-de-advertencias-usedfor)

---

## 1. Sección `repositories`

Los repositorios declaran los **contratos de acceso a datos** de cada agregado. El
generador los convierte en:

- Una **interfaz de dominio** (`{Aggregate}Repository.java`) en la capa de dominio
- Una **implementación JPA** (`{Aggregate}JpaRepository.java`) en la capa de infraestructura
- Una **implementación del adaptador de dominio** (`{Aggregate}RepositoryImpl.java`) que traduce entre dominio y JPA

### 1.1 Estructura base

```yaml
repositories:

  - aggregate: Product
    queryMethods:
      - name: findByStatus
        params:
          - name: status
            type: ProductStatus
            required: true
        returns: List[Product]

    methods:
      - name: findBySku
        signature: "findBySku(String(50)): Product?"

    bulkOperations: true   # expone saveAll, findAllById y count

    autoDerive: true        # default; poner false para desactivar la auto-derivación de uniqueness rules
```

### Propiedades de una entrada de repository

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `aggregate` | PascalCase | ✅ | Nombre del agregado. Debe coincidir con un agregado declarado en `aggregates[]`. |
| `queryMethods` | lista | no | Métodos de query con parámetros de filtro que generan una consulta JPQL `@Query` inline. |
| `methods` | lista | no | Métodos con firma directa (findBy*, save, delete, exists*, count*). |
| `bulkOperations` | `true` / omitido | no | Cuando `true`, expone `saveAll(List<T>)`, `findAllById(List<UUID>)` y `count()` en el puerto de dominio. |
| `autoDerive` | `true` / `false` | no | Default: `true`. Cuando `true`, deriva automáticamente métodos `findBy{Field}` a partir de `domainRules[].type: uniqueness`. Poner `false` para desactivar. |

---

### 1.2 Métodos de query (`queryMethods`)

Los `queryMethods` son métodos que aceptan filtros opcionales y generan una consulta
JPQL `@Query` inline con condiciones `IS NULL OR` para los parámetros opcionales.
Ideales para endpoints de búsqueda y listado con múltiples filtros opcionales.

```yaml
queryMethods:
  - name: searchProducts
    params:
      - name: status
        type: ProductStatus
        required: false
        filterOn: [status]
        operator: EQ

      - name: categoryId
        type: Uuid
        required: false
        filterOn: [categoryId]
        operator: EQ

      - name: searchTerm
        type: String
        required: false
        filterOn: [name]
        operator: LIKE_CONTAINS

      - name: minPrice
        type: Decimal
        required: false
        filterOn: [priceAmount]      # columna JPA (Money expandida)
        operator: GTE

      - name: maxPrice
        type: Decimal
        required: false
        filterOn: [priceAmount]
        operator: LTE

      - name: statusList
        type: List[ProductStatus]
        required: false
        filterOn: [status]
        operator: IN

      - name: pageable          # obligatorio cuando returns: Page[T]
        type: PageRequest
        required: true

    returns: Page[Product]
    defaultSort:
      field: createdAt
      direction: DESC
    sortable:
      - name
      - priceAmount
      - createdAt
```

#### Propiedades de un parámetro de `queryMethod`

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | camelCase | ✅ | Nombre del parámetro en Java. |
| `type` | tipo canónico | ✅ | Tipo del parámetro. `List[T]` activa operador `IN` por defecto. |
| `required` | boolean | no | Si `false`, el filtro se aplica solo cuando el parámetro no es `null`. Default: `true`. |
| `filterOn` | lista camelCase | no | Lista de columnas JPA sobre las que se aplica el filtro. Si se omite, se usa el nombre del propio parámetro como columna JPA. Cuando se declara `filterOn`, `operator` es **obligatorio**. |
| `operator` | enum | no si `filterOn` omitido | Operador de comparación. Ver tabla siguiente. **Obligatorio** cuando se declara `filterOn`. Sin `filterOn`: default `EQ` para escalares, `IN` para `List[T]`. |

#### Operadores disponibles

| Operador | JPQL generado | Uso típico |
|---|---|---|
| `EQ` | `field = :param` | Filtro exacto por estado, ID, booleano. |
| `LIKE_CONTAINS` | `LOWER(field) LIKE LOWER(CONCAT('%', :param, '%'))` | Búsqueda libre de texto (case-insensitive). |
| `LIKE_STARTS` | `LOWER(field) LIKE LOWER(CONCAT(:param, '%'))` | Autocompletado con prefijo (case-insensitive). |
| `LIKE_ENDS` | `LOWER(field) LIKE LOWER(CONCAT('%', :param))` | Sufijo (case-insensitive). |
| `GTE` | `field >= :param` | Rango inferior (precio mínimo, fecha desde). |
| `LTE` | `field <= :param` | Rango superior (precio máximo, fecha hasta). |
| `IN` | `field IN :param` | Filtro multi-valor. El parámetro debe ser `List[T]`. |

#### Propiedades de ordenación en `queryMethod`

| Propiedad | Tipo | Descripción |
|---|---|---|
| `defaultSort.field` | camelCase | Campo de ordenación por defecto. El validador verifica que sea un atributo conocido del agregado (incluyendo `id`, `createdAt`, `updatedAt`, `deletedAt`). Solo aplicado por el generador en retornos `List[T]`; para `Page[T]` el orden lo controla `Pageable.sort` en runtime. |
| `defaultSort.direction` | `ASC` \| `DESC` | Dirección de ordenación. Default: `ASC`. |
| `sortable` | lista camelCase | Campos por los que se puede ordenar. Cada campo se valida contra los atributos del agregado. |

#### Tipos de retorno disponibles en `returns`

| Valor | Java | Uso |
|---|---|---|
| `Page[T]` | `Page<T>` | Listado paginado con total count. |
| `Slice[T]` | `Slice<T>` | Listado paginado sin total (cursor-style, más eficiente). |
| `Stream[T]` | `Stream<T>` | Procesamiento incremental de grandes volúmenes. |
| `List[T]` | `List<T>` | Lista completa (sin paginación). |
| `T?` | `Optional<T>` | Un resultado opcional. |
| `T` | `T` | Un resultado obligatorio. |
| `void` | `void` | Operación sin retorno. |
| `Boolean` | `boolean` | Para `exists*` o `count*`. |
| `Long` | `long` | Para métodos de conteo. |
| `Int` | `int` | Para conteos de menor escala. |

#### Código Java generado

**`ProductRepository.java`** (interfaz de dominio):
```java
package com.canastaShop.catalog.domain.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

public interface ProductRepository {

    Page<Product> searchProducts(
        ProductStatus status,
        UUID categoryId,
        String searchTerm,
        BigDecimal minPrice,
        BigDecimal maxPrice,
        List<ProductStatus> statusList,
        Pageable pageable
    );

    Optional<Product> findBySku(String sku);

    Optional<Product> findById(UUID id);
    void save(Product product);
    void delete(Product product);
    boolean existsById(UUID id);
    Page<Product> findAll(Pageable pageable);
}
```

**`ProductJpaRepository.java`** (interfaz Spring Data con `@Query` JPQL inline):
```java
package com.canastaShop.catalog.infrastructure.persistence.repositories;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.Optional;
import java.util.UUID;

public interface ProductJpaRepository extends JpaRepository<ProductJpa, UUID> {

    @Query("SELECT p FROM ProductJpa p WHERE " +
           "(:status IS NULL OR p.status = :status) AND " +
           "(:categoryId IS NULL OR p.categoryId = :categoryId) AND " +
           "(:searchTerm IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', :searchTerm, '%'))) AND " +
           "(:minPrice IS NULL OR p.priceAmount >= :minPrice) AND " +
           "(:maxPrice IS NULL OR p.priceAmount <= :maxPrice) AND " +
           "(:statusList IS NULL OR p.status IN :statusList)")
    Page<ProductJpa> searchProducts(
        @Param("status") ProductStatus status,
        @Param("categoryId") UUID categoryId,
        @Param("searchTerm") String searchTerm,
        @Param("minPrice") BigDecimal minPrice,
        @Param("maxPrice") BigDecimal maxPrice,
        @Param("statusList") List<ProductStatus> statusList,
        Pageable pageable
    );

    Optional<ProductJpa> findBySku(String sku);
}
```

**`ProductRepositoryImpl.java`** (adaptador que implementa el puerto de dominio):
```java
@Repository
@Transactional(readOnly = true)
public class ProductRepositoryImpl implements ProductRepository {

    private final ProductJpaRepository jpaRepository;
    private final ProductJpaMapper mapper;

    @Override
    public Page<Product> searchProducts(
        ProductStatus status, UUID categoryId, String searchTerm,
        BigDecimal minPrice, BigDecimal maxPrice, List<ProductStatus> statusList,
        Pageable pageable) {

        return jpaRepository.searchProducts(
            status, categoryId, searchTerm, minPrice, maxPrice, statusList, pageable
        ).map(mapper::toDomain);
    }
}
```

---

### 1.3 Métodos personalizados (`methods`)

Los `methods` son métodos de repositorio con firma directa. Se usan para métodos no
soportados por `autoDerive` o para métodos con lógica JPA específica.

```yaml
methods:
  # Formato signature (recomendado)
  - name: findBySku
    signature: "findBySku(String(50)): Product?"

  # Formato params/returns
  - name: findByEmail
    params:
      - name: email
        type: Email
        required: true
    returns: Customer?

  # Conteo — usa params/returns para nombrar correctamente el parámetro
  - name: countActiveByCategoryId
    params:
      - name: categoryId
        type: Uuid
        required: true
    returns: Int

  # Existencia
  - name: existsBySkuAndIdNot
    params:
      - name: sku
        type: String(50)
        required: true
      - name: id
        type: Uuid
        required: true
    returns: Boolean

  # Con derivedFrom (indica que el método se deriva de un domainRule)
  - name: findBySlug
    signature: "findBySlug(Slug): Product?"
    derivedFrom: PRD-RULE-002

  # Parámetros opcionales
  - name: findByStatusAndCategory
    params:
      - name: status
        type: ProductStatus
        required: false
      - name: categoryId
        type: Uuid
        required: false
    returns: List[Product]
```

#### Sintaxis de `signature`

`{methodName}({param1Type}, {param2Name}?: {param2Type}): {returnType}`

- Los tipos se usan directamente del mapeo canónico (ver tabla de tipos)
- El `?` marca parámetros opcionales: `paramName?: Type`
- Para nombrar un parámetro requerido explícitamente, usa el formato `params/returns` en lugar de `signature`

**Código Java generado:**
```java
// En la interfaz de dominio ProductRepository:
Optional<Product> findBySku(String sku);
int countActiveByCategoryId(UUID categoryId);
boolean existsBySkuAndIdNot(String sku, UUID id);

// En ProductJpaRepository:
Optional<ProductJpa> findBySku(String sku);           // Spring Data derived

@Query("SELECT COUNT(p) FROM ProductJpa p WHERE p.status = 'ACTIVE' AND p.categoryId = :categoryId")
int countActiveByCategoryId(@Param("categoryId") UUID categoryId);
```

---

### 1.4 Operaciones en bulk (`bulkOperations`)

Cuando `true`, expone en el puerto de dominio y en `RepositoryImpl` tres métodos
que procesan colecciones en una sola llamada a Spring Data JPA.

```yaml
bulkOperations: true   # expone saveAll, findAllById y count
```

**Métodos generados en el puerto de dominio:**
```java
List<Product> saveAll(List<Product> entities);
List<Product> findAllById(List<UUID> ids);
long count();
```

Estos métodos son heredados directamente de `JpaRepository` y no requieren
declaración adicional en la interfaz Spring Data JPA.

> **Nota:** `deleteAll(List<T>)` **no** es generado por `bulkOperations`. Para
> eliminar en batch, declara un método explícito en `methods[]`.

---

### 1.5 Derivación automática (`autoDerive`)

Cuando `true` (default), el generador inspecciona cada `domainRules[].type: uniqueness`
declarada en el agregado y añade automáticamente un método `findBy{Field}: Aggregate?`
en el repositorio si el campo es una propiedad del agregado raíz y el método aún
no ha sido declarado explícitamente.

Pon `autoDerive: false` para desactivar este comportamiento y declarar todos los
métodos manualmente.

```yaml
# Default — activado
autoDerive: true

# Opt-out explícito
autoDerive: false
```

**Ejemplo:** un agregado con `domainRules: [{id: PRD-RULE-001, type: uniqueness, field: sku}]`
y sin método `findBySku` ni `existsBySku` declarado provocará que el generador inyecte:

```yaml
# Método auto-derivado (equivalente a declarar manualmente):
methods:
  - name: findBySku
    params:
      - name: sku
        type: String(50)   # tipo tomado de la propiedad del agregado
    returns: Product?
    derivedFrom: PRD-RULE-001
```

> **Restricción:** si el campo pertenece a una entidad hija (no al agregado raíz),
> la derivación se omite automáticamente. La unicidad en esos campos se aplica
> solo a nivel de constraint de base de datos.

---

## 2. Sección `errors`

Declara el catálogo completo de errores del BC. Cada entrada genera una clase Java
de excepción que el handler global (`HandlerExceptions.java`) convierte en una
respuesta HTTP estructurada.

### 2.1 Propiedades base

```yaml
errors:

  - code: PRODUCT_NOT_FOUND
    httpStatus: 404
    description: The requested product does not exist.
    message: Product with the given identifier was not found.
    title: Product Not Found

  - code: PRODUCT_CANNOT_BE_ACTIVATED
    httpStatus: 422
    description: A product can only be activated if it is in DRAFT status.
    message: The product cannot be activated because it is not in DRAFT status.
```

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `code` | SCREAMING_SNAKE_CASE | ✅ | Identificador único del error en el BC. Referenciado en `domainRules[].errorCode`, `notFoundError`, `lookups[].errorCode`, `fkValidations[].error`, `validations[].errorCode`. |
| `httpStatus` | integer | ✅ | Código HTTP de la respuesta. Ver §2.2. |
| `description` | texto | no | Descripción técnica interna. Solo referencia y documentación. |
| `message` | texto | no | Mensaje de error para el usuario final. |
| `title` | texto | no | Título corto de la respuesta de error. |

### 2.2 `httpStatus` — valores disponibles

Solo se aceptan los siguientes valores (cualquier otro falla la build):

| Código | Significado | Cuándo usarlo |
|---|---|---|
| `400` | Bad Request | El request es inválido sintácticamente. |
| `401` | Unauthorized | El usuario no está autenticado. |
| `402` | Payment Required | La operación requiere pago previo. |
| `403` | Forbidden | El usuario no tiene permisos. |
| `404` | Not Found | El recurso no existe. |
| `408` | Request Timeout | La operación tardó demasiado. |
| `409` | Conflict | Conflicto de estado (e.g. SKU duplicado). |
| `412` | Precondition Failed | Precondición de negocio no cumplida (ETag, estado requerido). |
| `415` | Unsupported Media Type | Tipo de archivo no soportado. |
| `422` | Unprocessable Entity | Regla de negocio violada. **El más común para errores de dominio.** |
| `423` | Locked | El recurso está bloqueado temporalmente. |
| `429` | Too Many Requests | Rate limit excedido. |
| `503` | Service Unavailable | Dependencia externa no disponible. |
| `504` | Gateway Timeout | Timeout en dependencia externa. |

### Código Java generado

El generador mapea `httpStatus` a la clase base de excepción:

| `httpStatus` | Clase base generada |
|---|---|
| `404` | `NotFoundException` |
| `409` | `ConflictException` |
| `400` | `BadRequestException` |
| `403` | `ForbiddenException` |
| `401` | `UnauthorizedException` |
| `422` | `BusinessException` |
| `402, 408, 412, 415, 423, 429, 503, 504` | `DomainException` |

Todas estas clases están en el paquete `{packageName}.shared.domain.customExceptions`.

Para `code: PRODUCT_NOT_FOUND` con `httpStatus: 404`:

**`ProductNotFoundError.java`:**
```java
package com.canastaShop.catalog.domain.errors;

import com.canastaShop.shared.domain.customExceptions.NotFoundException;

/**
 * The requested product does not exist.
 */
// derived_from: errors[PRODUCT_NOT_FOUND]
public class ProductNotFoundError extends NotFoundException {

    public ProductNotFoundError() {
        super("PRODUCT_NOT_FOUND");
    }
}
```

> **Nota:** el campo `message` del YAML es metadata de documentación (aparece en el
> catálogo de errores generado). Para que el mensaje llegue al constructor Java usa
> `messageTemplate` (ver §2.4). Sin `messageTemplate`, el constructor llama a
> `super("CODE")` y el código se usa como texto del mensaje.

El `HandlerExceptions` convierte la excepción por **jerarquía**, no por clase individual:
```java
// HandlerExceptions.java (fragmento — aplica a TODOS los NotFoundException del BC)
@ResponseStatus(HttpStatus.NOT_FOUND)
@ExceptionHandler(NotFoundException.class)
@ResponseBody
public ErrorResponse onNotFoundException(NotFoundException ex) {
    return buildResponse(HttpStatus.NOT_FOUND, "Not Found", ex, "Resource not found");
}
```

---

### 2.3 Personalización con `errorType`

Por defecto, el nombre de la clase Java se deriva del `code` convirtiendo
`SCREAMING_SNAKE_CASE` a `PascalCase` + `Error`:

`PRODUCT_NOT_FOUND` → `ProductNotFoundError`

Para casos especiales, se puede forzar un nombre específico:

```yaml
errors:
  - code: VALIDATION_ERROR
    httpStatus: 400
    errorType: RequestValidationError    # nombre explícito de la clase Java
    description: One or more request fields are invalid.
```

**`RequestValidationError.java`:**
```java
// derived_from: errors[VALIDATION_ERROR]
public class RequestValidationError extends BadRequestException {

    public RequestValidationError() {
        super("VALIDATION_ERROR");
    }
}
```

> **Regla de nomenclatura:** `errorType` debe ser `PascalCase`. El generador valida
> con regex `^[A-Z][A-Za-z0-9_]*$`.

---

### 2.4 Errores parametrizados: `messageTemplate` y `args`

Cuando el mensaje de error debe incluir datos dinámicos del contexto (e.g. el SKU
que causó el conflicto):

```yaml
errors:
  - code: PRODUCT_SKU_ALREADY_EXISTS
    httpStatus: 409
    messageTemplate: "A product with SKU '{sku}' already exists."
    args:
      - name: sku
        type: String
    description: Duplicate SKU constraint violation.
```

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `messageTemplate` | string con `{arg}` placeholders | ✅ si `args` declarado | Plantilla del mensaje. Los placeholders `{argName}` son reemplazados en runtime. |
| `args` | lista | no | Parámetros tipados de la plantilla. |
| `args[].name` | camelCase | ✅ | Nombre del argumento. |
| `args[].type` | tipo Java simple | ✅ | Tipo Java del argumento (e.g. `String`, `UUID`, `Integer`). |

> **Restricción:** `args` requiere `messageTemplate`. Si se declaran args sin template,
> la build falla.

**`ProductSkuAlreadyExistsError.java`:**
```java
// derived_from: errors[PRODUCT_SKU_ALREADY_EXISTS]
public class ProductSkuAlreadyExistsError extends ConflictException {

    public ProductSkuAlreadyExistsError(String sku) {
        super("A product with SKU '" + String.valueOf(sku) + "' already exists.",
              "PRODUCT_SKU_ALREADY_EXISTS", 409, new Object[]{ sku });
    }
}
```

**Uso en el handler:**
```java
throw new ProductSkuAlreadyExistsError(command.sku());
```

---

### 2.5 Encadenamiento con `chainable`

Cuando el error debe preservar la causa original de la excepción (para logging y
debugging de la cadena de errores):

```yaml
errors:
  - code: PAYMENT_PROCESSING_FAILED
    httpStatus: 503
    description: The payment gateway returned an unexpected error.
    chainable: true
```

**`PaymentProcessingFailedError.java`:**
```java
// derived_from: errors[PAYMENT_PROCESSING_FAILED]
public class PaymentProcessingFailedError extends DomainException {

    public PaymentProcessingFailedError() {
        super("PAYMENT_PROCESSING_FAILED");
    }

    // chainable: true → constructor adicional con cause
    public PaymentProcessingFailedError(Throwable cause) {
        super("PAYMENT_PROCESSING_FAILED", cause);
    }
}
```

**Uso en el adaptador:**
```java
try {
    gatewayClient.chargeCard(request);
} catch (FeignException e) {
    throw new PaymentProcessingFailedError(e);  // ← preserva la causa original
}
```

---

### 2.6 Taxonomía: `kind` y `triggeredBy`

Distingue errores de **negocio** (causados por el estado del dominio) de errores de
**infraestructura** (causados por dependencias técnicas). Esta distinción controla qué
handler global los procesa.

```yaml
errors:
  # Error de negocio (por defecto)
  - code: PRODUCT_CANNOT_BE_ACTIVATED
    httpStatus: 422
    kind: business           # opcional; business es el default

  # Error de infraestructura — mapeado desde una excepción técnica específica
  - code: DATABASE_CONNECTION_FAILED
    httpStatus: 503
    kind: infrastructure
    triggeredBy: org.springframework.dao.DataAccessException
    chainable: true
    description: The database is temporarily unavailable.
```

| Propiedad | Tipo | Descripción |
|---|---|---|
| `kind` | `business` \| `infrastructure` | Default: `business`. `infrastructure` activa la lógica de `triggeredBy`. |
| `triggeredBy` | nombre de clase Java (simple o FQN) | Solo para `kind: infrastructure`. El `HandlerExceptions` global registra un `@ExceptionHandler` para esta excepción JVM y la convierte en el error declarado. |

**Restricciones:**
- `triggeredBy` solo se puede declarar cuando `kind: infrastructure`
- `triggeredBy` debe ser un nombre de clase válido Java (FQN o simple)
- Si el mismo `triggeredBy` está mapeado a dos errores **diferentes** en distintos BCs, la build falla con error de ambigüedad (el mapeo debe ser unívoco por excepción JVM)

**Código generado en `HandlerExceptions.java`:**

Cuando `triggeredBy` es un FQN, la clase se importa y se usa el nombre simple en el handler:
```java
// import org.springframework.dao.DataAccessException; ← importado automáticamente
@ExceptionHandler(DataAccessException.class)
@ResponseBody
public ResponseEntity<ErrorResponse> onDatabaseConnectionFailedError(
    DataAccessException ex) {

    log.warn("Infrastructure failure mapped to DATABASE_CONNECTION_FAILED", ex);
    DomainException domainEx = new DatabaseConnectionFailedError();
    Integer rawStatus = domainEx.getHttpStatus();
    HttpStatus status = rawStatus != null ? HttpStatus.valueOf(rawStatus) : HttpStatus.SERVICE_UNAVAILABLE;
    ErrorResponse body = new ErrorResponse(
            status.value(),
            status.getReasonPhrase(),
            domainEx.getCode(),
            domainEx.getMessage() != null ? domainEx.getMessage() : status.getReasonPhrase(),
            domainEx.getDetails()
    );
    return ResponseEntity.status(status).body(body);
}
```

> **Nota:** la excepción original `ex` se pasa solo al logger; la instancia
> `domainEx` se construye con el constructor sin argumentos. El `cause` NO
> se encadena automáticamente aunque el error declare `chainable: true`.

---

### 2.7 Control de advertencias: `usedFor`

El generador emite una advertencia cuando un error está declarado en `errors[]` pero
ningún `domainRule`, `notFoundError`, `fkValidations` o `validations` lo referencia
(error huérfano). Para suprimir la advertencia:

```yaml
errors:
  # Este error se lanza manualmente en la Fase 3 — no se puede declarar en el YAML
  - code: SAGA_COMPENSATION_FAILED
    httpStatus: 503
    usedFor: manual       # suprime la advertencia de error huérfano
    description: >
      Thrown during saga compensation when the rollback operation also fails.
      This error is emitted manually from the saga orchestrator.
```

| Valor | Comportamiento |
|---|---|
| `auto` | Default. El generador advierte si el error no es referenciado por ningún artefacto del YAML. |
| `manual` | El error se lanza manualmente en código no generado. Se suprime la advertencia. |

---

### Ejemplo completo de la sección `errors`

```yaml
errors:

  - code: PRODUCT_NOT_FOUND
    httpStatus: 404
    title: Product Not Found
    message: The requested product does not exist in the catalog.
    description: Thrown when a product lookup by ID returns no result.

  - code: PRODUCT_CANNOT_BE_ACTIVATED
    httpStatus: 422
    title: Product Cannot Be Activated
    message: The product cannot be activated because it is not in DRAFT status.
    description: State precondition violation for the activate transition.

  - code: PRODUCT_SKU_ALREADY_EXISTS
    httpStatus: 409
    title: SKU Already Exists
    messageTemplate: "A product with SKU '{sku}' already exists in the catalog."
    args:
      - name: sku
        type: String
    description: Uniqueness constraint violation on the product SKU field.

  - code: PRODUCT_CATEGORY_NOT_ACTIVE
    httpStatus: 422
    title: Category Not Active
    message: Products can only be assigned to active categories.
    description: Cross-aggregate constraint violation.

  - code: CATEGORY_NOT_FOUND
    httpStatus: 404
    title: Category Not Found
    message: The referenced category does not exist.

  - code: INVALID_FILE_TYPE
    httpStatus: 415
    title: Unsupported File Type
    message: Only PNG, JPEG and WebP image files are accepted.
    description: Thrown when an uploaded image has an unsupported MIME type.

  - code: CATALOG_SERVICE_UNAVAILABLE
    httpStatus: 503
    kind: infrastructure
    triggeredBy: feign.FeignException
    chainable: true
    title: Catalog Service Unavailable
    message: The catalog service is temporarily unavailable. Please retry later.
    description: >
      Thrown when the Feign client receives a non-2xx response or a connection error
      from the catalog service. The FeignException is preserved as the cause.

  - code: EXTERNAL_AUDIT_LOG_FAILED
    httpStatus: 503
    kind: infrastructure
    usedFor: manual
    description: >
      Thrown manually in the audit log adapter when the external audit service
      is unreachable. Not wired to any domain rule — thrown from infrastructure code.
```
