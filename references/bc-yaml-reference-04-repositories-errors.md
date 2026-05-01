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
- **Specifications** dinámicas (`{Aggregate}Specification.java`) cuando se declaran
  parámetros con `filterOn` u `operator`

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

    bulkOperations:
      - save
      - delete

    autoDerive:
      - findById
      - save
      - delete
      - existsById
      - findAll
```

### Propiedades de una entrada de repository

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `aggregate` | PascalCase | ✅ | Nombre del agregado. Debe coincidir con un agregado declarado en `aggregates[]`. |
| `queryMethods` | lista | no | Métodos de query con parámetros de filtro opcionales que generan `Specification`. |
| `methods` | lista | no | Métodos con firma directa (findBy*, save, delete, exists*, count*). |
| `bulkOperations` | lista | no | Operaciones en batch (`save`, `delete`). |
| `autoDerive` | lista | no | Métodos estándar Spring Data que se generan automáticamente sin configuración adicional. |

---

### 1.2 Métodos de query (`queryMethods`)

Los `queryMethods` son métodos que aceptan filtros opcionales y generan
`Specification<AggregateJpa>` dinámicamente. Ideales para endpoints de búsqueda
y listado con múltiples filtros opcionales.

```yaml
queryMethods:
  - name: searchProducts
    params:
      - name: status
        type: ProductStatus
        required: false
        filterOn: status
        operator: EQ

      - name: categoryId
        type: Uuid
        required: false
        filterOn: categoryId
        operator: EQ

      - name: searchTerm
        type: String
        required: false
        filterOn: name
        operator: LIKE_CONTAINS

      - name: minPrice
        type: Decimal
        required: false
        filterOn: priceAmount      # columna JPA (Money expandida)
        operator: GTE

      - name: maxPrice
        type: Decimal
        required: false
        filterOn: priceAmount
        operator: LTE

      - name: statusList
        type: List[ProductStatus]
        required: false
        filterOn: status
        operator: IN

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
| `filterOn` | camelCase | no | Nombre de la columna JPA sobre la que se aplica el filtro. Si se omite, se asume el mismo `name`. |
| `operator` | enum | no | Operador de comparación. Ver tabla siguiente. Default: `EQ` para escalares, `IN` para `List[T]`. |

#### Operadores disponibles

| Operador | SQL generado | Uso típico |
|---|---|---|
| `EQ` | `WHERE field = :value` | Filtro exacto por estado, ID, booleano. |
| `LIKE_CONTAINS` | `WHERE LOWER(field) LIKE '%value%'` | Búsqueda libre de texto. |
| `LIKE_STARTS` | `WHERE LOWER(field) LIKE 'value%'` | Autocompletado con prefijo. |
| `LIKE_ENDS` | `WHERE LOWER(field) LIKE '%value'` | Sufijo. |
| `GTE` | `WHERE field >= :value` | Rango inferior (precio mínimo, fecha desde). |
| `LTE` | `WHERE field <= :value` | Rango superior (precio máximo, fecha hasta). |
| `IN` | `WHERE field IN (:values)` | Filtro multi-valor. El parámetro debe ser `List[T]`. |

#### Propiedades de ordenación en `queryMethod`

| Propiedad | Tipo | Descripción |
|---|---|---|
| `defaultSort.field` | camelCase | Campo de ordenación por defecto. Debe estar en `sortable`. |
| `defaultSort.direction` | `ASC` \| `DESC` | Dirección de ordenación. Default: `ASC`. |
| `sortable` | lista camelCase | Campos por los que se puede ordenar. |

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

**`ProductJpaRepository.java`** (implementación Spring Data):
```java
package com.canastaShop.catalog.infrastructure.persistence.repositories;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import java.util.Optional;
import java.util.UUID;

public interface ProductJpaRepository
    extends JpaRepository<ProductJpa, UUID>, JpaSpecificationExecutor<ProductJpa> {

    Optional<ProductJpa> findBySku(String sku);
}
```

**`ProductRepositoryImpl.java`** (adaptador que implementa el puerto de dominio):
```java
@Repository
public class ProductRepositoryImpl implements ProductRepository {

    private final ProductJpaRepository jpaRepository;
    private final ApplicationMapper mapper;

    @Override
    public Page<Product> searchProducts(
        ProductStatus status, UUID categoryId, String searchTerm,
        BigDecimal minPrice, BigDecimal maxPrice, List<ProductStatus> statusList,
        Pageable pageable) {

        Specification<ProductJpa> spec = Specification.where(null);
        if (status != null) spec = spec.and(ProductSpecification.status(status));
        if (categoryId != null) spec = spec.and(ProductSpecification.categoryId(categoryId));
        if (searchTerm != null) spec = spec.and(ProductSpecification.searchName(searchTerm));
        if (minPrice != null) spec = spec.and(ProductSpecification.minPriceAmount(minPrice));
        if (maxPrice != null) spec = spec.and(ProductSpecification.maxPriceAmount(maxPrice));
        if (statusList != null && !statusList.isEmpty())
            spec = spec.and(ProductSpecification.statusIn(statusList));

        return jpaRepository.findAll(spec, pageable).map(mapper::toDomain);
    }
}
```

**`ProductSpecification.java`:**
```java
public class ProductSpecification {

    public static Specification<ProductJpa> status(ProductStatus value) {
        return (root, query, cb) -> cb.equal(root.get("status"), value);
    }

    public static Specification<ProductJpa> categoryId(UUID value) {
        return (root, query, cb) -> cb.equal(root.get("categoryId"), value);
    }

    public static Specification<ProductJpa> searchName(String value) {
        return (root, query, cb) ->
            cb.like(cb.lower(root.get("name")), "%" + value.toLowerCase() + "%");
    }

    public static Specification<ProductJpa> minPriceAmount(BigDecimal value) {
        return (root, query, cb) -> cb.greaterThanOrEqualTo(root.get("priceAmount"), value);
    }

    public static Specification<ProductJpa> maxPriceAmount(BigDecimal value) {
        return (root, query, cb) -> cb.lessThanOrEqualTo(root.get("priceAmount"), value);
    }

    public static Specification<ProductJpa> statusIn(List<ProductStatus> values) {
        return (root, query, cb) -> root.get("status").in(values);
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

  # Conteo
  - name: countActiveByCategoryId
    signature: "countActiveByCategoryId(Uuid): Long"

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
- El `?` marca parámetros opcionales
- Con `paramName: Type` se puede nombrar el parámetro explícitamente

**Código Java generado:**
```java
// En la interfaz de dominio ProductRepository:
Optional<Product> findBySku(String sku);
long countActiveByCategoryId(UUID categoryId);
boolean existsBySkuAndIdNot(String sku, UUID id);

// En ProductJpaRepository (Spring Data derivado automáticamente):
Optional<ProductJpa> findBySku(String sku);

@Query("SELECT COUNT(p) FROM ProductJpa p WHERE p.categoryId = :categoryId " +
       "AND p.status = 'ACTIVE'")
long countActiveByCategoryId(@Param("categoryId") UUID categoryId);
```

---

### 1.4 Operaciones en bulk (`bulkOperations`)

Declara operaciones que procesan colecciones de entidades en una sola llamada.

```yaml
bulkOperations:
  - save      # saveAll(List<Product>)
  - delete    # deleteAll(List<Product>)
```

**Código Java generado:**
```java
// En la interfaz de dominio:
void saveAll(List<Product> products);
void deleteAll(List<Product> products);

// En la implementación JPA:
@Override
public void saveAll(List<Product> products) {
    jpaRepository.saveAll(products.stream().map(mapper::toJpa).collect(Collectors.toList()));
}
```

---

### 1.5 Derivación automática (`autoDerive`)

Lista los métodos CRUD estándar que Spring Data JPA soporta nativamente y que el
generador incluye sin necesidad de declarar una firma explícita.

```yaml
autoDerive:
  - findById        # Optional<T> findById(UUID id)
  - findAll         # Page<T> findAll(Pageable pageable)
  - save            # void save(T entity)
  - delete          # void delete(T entity)
  - deleteById      # void deleteById(UUID id)
  - existsById      # boolean existsById(UUID id)
  - count           # long count()
```

**Código Java generado** (en la interfaz de dominio):
```java
Optional<Product> findById(UUID id);
Page<Product> findAll(Pageable pageable);
void save(Product product);
void delete(Product product);
void deleteById(UUID id);
boolean existsById(UUID id);
long count();
```

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

Para `code: PRODUCT_NOT_FOUND` con `httpStatus: 404`:

**`ProductNotFoundError.java`:**
```java
package com.canastaShop.catalog.domain.errors;

import com.canastaShop.shared.domain.exceptions.BusinessException;

public class ProductNotFoundError extends BusinessException {

    private static final String CODE = "PRODUCT_NOT_FOUND";
    private static final int HTTP_STATUS = 404;
    private static final String MESSAGE = "Product with the given identifier was not found.";
    private static final String TITLE = "Product Not Found";

    public ProductNotFoundError() {
        super(CODE, HTTP_STATUS, MESSAGE, TITLE);
    }
}
```

El handler global convierte la excepción en la respuesta HTTP:
```java
// HandlerExceptions.java (fragmento generado para BC catalog):
@ExceptionHandler(ProductNotFoundError.class)
public ResponseEntity<ErrorResponse> handleProductNotFoundError(ProductNotFoundError ex) {
    return ResponseEntity.status(ex.getHttpStatus())
        .body(new ErrorResponse(ex.getCode(), ex.getMessage(), ex.getTitle()));
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
public class RequestValidationError extends BusinessException {
    // ...
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
public class ProductSkuAlreadyExistsError extends BusinessException {

    private static final String CODE = "PRODUCT_SKU_ALREADY_EXISTS";
    private static final int HTTP_STATUS = 409;
    private static final String TEMPLATE = "A product with SKU ''{0}'' already exists.";

    public ProductSkuAlreadyExistsError(String sku) {
        super(CODE, HTTP_STATUS,
              MessageFormat.format(TEMPLATE, sku),
              "Product SKU Already Exists");
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
public class PaymentProcessingFailedError extends BusinessException {

    public PaymentProcessingFailedError() {
        super("PAYMENT_PROCESSING_FAILED", 503,
              "Payment processing failed due to an unexpected error.",
              "Payment Processing Failed");
    }

    // chainable: true → constructor adicional con cause
    public PaymentProcessingFailedError(Throwable cause) {
        super("PAYMENT_PROCESSING_FAILED", 503,
              "Payment processing failed due to an unexpected error.",
              "Payment Processing Failed",
              cause);
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
- Si dos errores en distintos BCs declaran el mismo `triggeredBy`, la build falla
  (el mapeo debe ser unívoco)

**Código generado en `HandlerExceptions.java`:**
```java
// derived_from: errors[kind=infrastructure, triggeredBy=DataAccessException]
@ExceptionHandler(org.springframework.dao.DataAccessException.class)
public ResponseEntity<ErrorResponse> handleDataAccessException(
    org.springframework.dao.DataAccessException ex) {

    DatabaseConnectionFailedError error = new DatabaseConnectionFailedError(ex);
    return ResponseEntity.status(503)
        .body(new ErrorResponse(error.getCode(), error.getMessage(), error.getTitle()));
}
```

---

### 2.7 Control de advertencias: `usedFor`

El generador emite una advertencia cuando un error está declarado en `errors[]` pero
ningún `domainRule`, `notFoundError`, `fkValidations` o `validations` lo referencia
(error huérfano). Para suprimir la advertencia:

```yaml
errors:
  # Este error se lanza manualmente en la Fase 3 — no se puede declarar en el YAML
  - code: SAGA_COMPENSATION_FAILED
    httpStatus: 500
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
    httpStatus: 500
    kind: infrastructure
    usedFor: manual
    description: >
      Thrown manually in the audit log adapter when the external audit service
      is unreachable. Not wired to any domain rule — thrown from infrastructure code.
```
