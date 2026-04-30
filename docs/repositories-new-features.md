# Nuevas características soportadas en archivos de diseño — Repositories

Este documento describe las extensiones del schema YAML de Bounded Context introducidas por las **Fases 1 a 3** del plan de remediación de `repositories[]` (ver [analisis/repositories-analisis.md](../analisis/repositories-analisis.md)). Todas las extensiones son **opcionales** y **retrocompatibles**: los `{bc}.yaml` existentes siguen produciendo el mismo código sin modificaciones.

> Las reglas siguen siendo declarativas, deterministas y agnósticas a la tecnología: si el YAML no provee el _hint_ necesario, el generador NO infiere — falla con error explícito o emite `// TODO`. Ver [AGENTS.md](../AGENTS.md).

---

## Índice

### Fase 1 — corrección y validación

1. [`validateRepositories` — checks bloqueantes para `repositories[]` (R16)](#1-validaterepositories--checks-bloqueantes-para-repositories-r16)
2. [`findBy{C1}And{C2}…` multi-campo derivado (R2)](#2-findbyc1andc2-multi-campo-derivado-r2)
3. [Soft-delete con `updatedAt` y idempotencia (R3)](#3-soft-delete-con-updatedat-y-idempotencia-r3)
4. [Trazabilidad `// derived_from` en métodos del repositorio (R17)](#4-trazabilidad--derived_from-en-métodos-del-repositorio-r17)
5. [`delete` huérfano sin `softDelete` ni `deleteGuard` (R18)](#5-delete-huérfano-sin-softdelete-ni-deleteguard-r18)
6. [Read models bloquean `save` / `delete` (R19)](#6-read-models-bloquean-save--delete-r19)

### Fase 2 — motor declarativo

7. [`operator` por param — whitelist de operadores (R1, R5, R9)](#7-operator-por-param--whitelist-de-operadores-r1-r5-r9)
8. [`defaultSort` y `sortable[]` — ordering declarativo (R8)](#8-defaultsort-y-sortable--ordering-declarativo-r8)
9. [`@Transactional` en `RepositoryImpl` (R20)](#9-transactional-en-repositoryimpl-r20)
10. [Mappers extraídos a `{Aggregate}JpaMapper` (R21)](#10-mappers-extraídos-a-aggregatejpamapper-r21)
11. [Cross-check `queryMethods` ↔ UCs Path B (R24)](#11-cross-check-querymethods--ucs-path-b-r24)

### Fase 3 — aditivos opt-in

12. [`existsBy{Campo}` derivado (R7)](#12-existsbycampo-derivado-r7)
13. [`deleteBy{Campo}` con `@Modifying` (R10)](#13-deletebycampo-con-modifying-r10)
14. [`bulkOperations: true` — `saveAll` / `findAllById` / `count()` (R11)](#14-bulkoperations-true--saveall--findallbyid--count-r11)
15. [`findByIdForUpdate` con `@Lock(PESSIMISTIC_WRITE)` (R13)](#15-findbyidforupdate-con-lockpessimistic_write-r13)
16. [`Slice[T]`, `Stream[T]`, `Long`, `Boolean` (R15, R22)](#16-slicet-streamt-long-boolean-r15-r22)
17. [Auto-derivación desde `domainRules` `uniqueness` (R25)](#17-auto-derivación-desde-domainrules-uniqueness-r25)

### Cierre

18. [Schema completo de `repositories[]`](#18-schema-completo-de-repositories)
19. [Limitaciones (lo que sigue NO soportado)](#19-limitaciones-lo-que-sigue-no-soportado)

---

## 1. `validateRepositories` — checks bloqueantes para `repositories[]` (R16)

Antes el bloque `repositories[]` se procesaba sin validación: typos en `aggregate`, métodos duplicados o `derivedFrom` apuntando a reglas inexistentes pasaban silenciosamente. Ahora `bc-yaml-reader.js` ejecuta `validateRepositories(doc)` antes de generar.

**Checks aplicados** (todos bloqueantes — falla con error explícito):

- `aggregate` debe existir en `aggregates[].name`.
- Whitelist de keys de repo: `aggregate`, `queryMethods`, `methods`, `bulkOperations`, `autoDerive`.
- Whitelist de keys de método: `name`, `params`, `returns`, `derivedFrom`, `signature`, `defaultSort`, `sortable`.
- Whitelist de keys de param: `name`, `type`, `required`, `filterOn`, `operator`.
- Whitelist de operadores: `EQ`, `LIKE_CONTAINS`, `LIKE_STARTS`, `LIKE_ENDS`, `GTE`, `LTE`, `IN`.
- `returns` debe coincidir con uno de: `void`, `Boolean`, `Int`, `Long`, `T`, `T?`, `List[T]`, `Page[T]`, `Slice[T]`, `Stream[T]`.
- Nombres de método únicos por repo.
- `derivedFrom: <RULE_ID>` debe existir en `domainRules[]` (raíz o anidados en agregados).
- `findBy*` debe retornar `T?` o `List[T]`; `countBy*` debe retornar `Int`/`Long`; `existsBy*` debe retornar `Boolean`.
- `Page[T]` requiere parámetro `Pageable` o pareja `page+size`.

**Ejemplo que ahora falla con mensaje claro:**

```yaml
repositories:
  - aggregate: Procuct           # typo
    methods:
      - name: findById
        params: [{ name: id, type: Uuid }]
        returns: Product?
```

```
✘ Repository declares aggregate "Procuct" but no aggregate with that name exists in aggregates[]. Did you mean one of: Product, Category?
```

---

## 2. `findBy{C1}And{C2}…` multi-campo derivado (R2)

Antes solo `findBy{Campo}` con un único param se clasificaba como `derived`. Ahora cualquier `findBy{C1}And{C2}…And{Cn}` con `n` parámetros no-pageable se reconoce como derivado y se delega a Spring Data — sin `@Query`.

**YAML:**

```yaml
repositories:
  - aggregate: Customer
    methods:
      - name: findByEmailAndTenantId
        params:
          - { name: email, type: Email }
          - { name: tenantId, type: Uuid }
        returns: Customer?
        derivedFrom: CST-RULE-001
```

**Java generado** (sin `@Query`):

```java
@Repository
public interface CustomerJpaRepository extends JpaRepository<CustomerJpa, UUID> {
    // derived_from: CST-RULE-001
    Optional<CustomerJpa> findByEmailAndTenantId(String email, UUID tenantId);
}
```

---

## 3. Soft-delete con `updatedAt` y idempotencia (R3)

Cuando un agregado declara `softDelete: true` y `auditable: true`, el JPQL inyectado para `softDelete(id)` ahora actualiza `updatedAt` y filtra por `deletedAt IS NULL` (idempotente, audit-correcto). `@Modifying` salta los lifecycle callbacks de JPA, por eso debe escribirse en el JPQL.

**YAML (sin cambios — aplica automáticamente):**

```yaml
aggregates:
  - name: Category
    auditable: true
    softDelete: true
```

**Java generado:**

```java
@Modifying
@Transactional
@Query("UPDATE CategoryJpa a SET a.deletedAt = CURRENT_TIMESTAMP, a.updatedAt = CURRENT_TIMESTAMP WHERE a.id = :id AND a.deletedAt IS NULL")
void softDelete(@Param("id") UUID id);
```

Si `auditable: false`, solo se actualiza `deletedAt`.

---

## 4. Trazabilidad `// derived_from` en métodos del repositorio (R17)

Cumple AGENTS.md §3 (Trazabilidad obligatoria). Cada método cuyo `derivedFrom` no sea `implicit` recibe un comentario que enlaza al origen.

**YAML:**

```yaml
methods:
  - name: findBySlug
    params: [{ name: slug, type: String }]
    returns: Category?
    derivedFrom: CAT-RULE-002
```

**Java generado** (en `CategoryRepository.java` y `CategoryJpaRepository.java`):

```java
// derived_from: CAT-RULE-002
Optional<Category> findBySlug(String slug);
```

---

## 5. `delete` huérfano sin `softDelete` ni `deleteGuard` (R18)

El generador exige una decisión explícita sobre el borrado. Si `repositories[].methods` declara `delete(id)`, debe cumplirse uno de:

- El agregado tiene `softDelete: true` (se renombra a `softDelete`).
- El método declara `derivedFrom: <RULE_ID>` apuntando a una `domainRule` `type: deleteGuard`.

De lo contrario, falla.

**Válido (deleteGuard):**

```yaml
domainRules:
  - id: CAT-RULE-003
    type: deleteGuard
    errorCode: CATEGORY_HAS_ACTIVE_PRODUCTS
    targetAggregate: Product
    targetRepositoryMethod: countActiveByCategoryId

repositories:
  - aggregate: Category
    methods:
      - name: delete
        params: [{ name: id, type: Uuid }]
        returns: void
        derivedFrom: CAT-RULE-003
```

---

## 6. Read models bloquean `save` / `delete` (R19)

Si el agregado declara `readModel: true`, el repositorio no puede exponer escrituras (los read models se hidratan vía proyecciones de eventos).

**Inválido — falla con error:**

```yaml
aggregates:
  - name: ProductSearchView
    readModel: true

repositories:
  - aggregate: ProductSearchView
    methods:
      - name: save                # ✘ rechazado
        params: [{ name: view, type: ProductSearchView }]
        returns: void
```

---

## 7. `operator` por param — whitelist de operadores (R1, R5, R9)

Antes `operator` se ignoraba silenciosamente. Ahora es respetado con dispatcher dedicado.

| Operador | JPQL emitido |
|---|---|
| `EQ` (default) | `a.f = :p` |
| `LIKE_CONTAINS` | `LOWER(a.f) LIKE LOWER(CONCAT('%', :p, '%'))` |
| `LIKE_STARTS` | `LOWER(a.f) LIKE LOWER(CONCAT(:p, '%'))` |
| `LIKE_ENDS` | `LOWER(a.f) LIKE LOWER(CONCAT('%', :p))` |
| `GTE` | `a.f >= :p` |
| `LTE` | `a.f <= :p` |
| `IN` | `a.f IN :p` (param tipo `List[T]`) |

**Inferencia segura:** sin `operator`, el generador aplica:
- Param con `filterOn: [a, b]` ⇒ `LIKE_CONTAINS` sobre las columnas listadas.
- Param tipo `List[T]` ⇒ `IN`.
- En cualquier otro caso ⇒ `EQ`.

**Ejemplo — rango de precios + búsqueda multi-columna:**

```yaml
queryMethods:
  - name: listByCriteria
    params:
      - { name: search, type: String, required: false, filterOn: [name, sku] }
      - { name: priceFrom, type: Decimal, required: false, operator: GTE }
      - { name: priceTo, type: Decimal, required: false, operator: LTE }
      - { name: statuses, type: List[ProductStatus], required: false, operator: IN }
      - { name: pageable, type: PageRequest }
    returns: Page[Product]
```

**JPQL generado:**

```sql
SELECT p FROM ProductJpa p WHERE
  (:search IS NULL OR (LOWER(p.name) LIKE LOWER(CONCAT('%', :search, '%')) OR LOWER(p.sku) LIKE LOWER(CONCAT('%', :search, '%'))))
  AND (:priceFrom IS NULL OR p.price >= :priceFrom)
  AND (:priceTo IS NULL OR p.price <= :priceTo)
  AND (:statuses IS NULL OR p.status IN :statuses)
```

---

## 8. `defaultSort` y `sortable[]` — ordering declarativo (R8)

Antes los listados quedaban con orden indefinido (bug clásico de paginación inestable). Dos hints opt-in:

- `defaultSort: { field, direction }` — ordering por defecto cuando el caller no pasa `Sort`.
- `sortable: [<field>, ...]` — campos permitidos en `Sort` dinámico.

**YAML:**

```yaml
queryMethods:
  - name: listByStatus
    params:
      - { name: status, type: CategoryStatus }
      - { name: pageable, type: PageRequest }
    returns: Page[Category]
    defaultSort: { field: createdAt, direction: DESC }
    sortable: [name, createdAt, updatedAt]
```

Para `Page[T]` el ordering se aplica vía `Pageable.sort` resuelto por Spring Data.
Para `List[T]` (sin paginación) el generador emite `ORDER BY a.{field} {ASC|DESC}` directamente en el JPQL.

---

## 9. `@Transactional` en `RepositoryImpl` (R20)

El adaptador ya no depende de que el caller abra la transacción. El generador emite:

- `@Transactional(readOnly = true)` a nivel de clase.
- `@Transactional` (read-write) en métodos `save`, `delete`, `softDelete`, `save*`, `delete*`.

**Java generado:**

```java
@Repository
@Transactional(readOnly = true)
public class CategoryRepositoryImpl implements CategoryRepository {
    // ...

    @Override
    @Transactional
    public void save(Category category) { ... }

    @Override
    @Transactional
    public void softDelete(UUID id) { ... }
}
```

---

## 10. Mappers extraídos a `{Aggregate}JpaMapper` (R21)

Antes los métodos `toDomain` / `toJpa` vivían inline dentro del `RepositoryImpl`. Ahora se generan en una clase dedicada `infrastructure/persistence/mappers/{Aggregate}JpaMapper.java` con `@Component`, inyectada en el adaptador. Reusable desde proyecciones, consumidores de eventos u otros adaptadores.

**Estructura generada (sin cambios en YAML):**

```
infrastructure/persistence/
├── mappers/
│   ├── CategoryJpaMapper.java     ← @Component, toDomain/toJpa
│   └── ProductJpaMapper.java
└── repositories/
    ├── CategoryRepositoryImpl.java  ← inyecta CategoryJpaMapper
    └── ProductRepositoryImpl.java
```

```java
public class CategoryRepositoryImpl implements CategoryRepository {
    private final CategoryJpaRepository jpaRepository;
    private final CategoryJpaMapper mapper;

    @Override
    public Optional<Category> findById(UUID id) {
        return jpaRepository.findById(id).map(mapper::toDomain);
    }
}
```

---

## 11. Cross-check `queryMethods` ↔ UCs Path B (R24)

`validateRepositories` cruza cada UC `type: query` que **no** declara `loadAggregate: true` con `queryMethods[]`. Si no hay un `queryMethod` resoluble, falla.

**Inválido:**

```yaml
useCases:
  - id: list-products
    type: query
    aggregate: Product
    input: [{ name: status, type: ProductStatus }]

repositories:
  - aggregate: Product
    queryMethods: []   # ✘ no hay queryMethod para list-products
```

```
✘ UC "list-products" (type: query, no loadAggregate) requires a queryMethod on repositories[Product] resolvable from input params [status].
```

---

## 12. `existsBy{Campo}` derivado (R7)

Patrón Spring Data nativo para checks pre-insert sin cargar la entidad. Ahora soportado.

**YAML:**

```yaml
methods:
  - name: existsByEmail
    params: [{ name: email, type: Email }]
    returns: Boolean
    derivedFrom: USR-RULE-001
```

**Java generado:**

```java
// derived_from: USR-RULE-001
boolean existsByEmail(String email);
```

`Boolean` se mapea a primitivo `boolean` (R15/R22).

---

## 13. `deleteBy{Campo}` con `@Modifying` (R10)

Bulk delete declarativo. Emite `@Modifying @Transactional @Query` con DELETE JPQL.

**YAML:**

```yaml
methods:
  - name: deleteByTenantId
    params: [{ name: tenantId, type: Uuid }]
    returns: void
    derivedFrom: TNT-RULE-005
```

**Java generado:**

```java
// derived_from: TNT-RULE-005
@Modifying
@Transactional
@Query("DELETE FROM SessionJpa a WHERE a.tenantId = :tenantId")
void deleteByTenantId(@Param("tenantId") UUID tenantId);
```

> ⚠ No usar sobre agregados con `softDelete: true` — esto es **borrado físico**.

---

## 14. `bulkOperations: true` — `saveAll` / `findAllById` / `count()` (R11)

Flag opt-in a nivel de repo que expone tres métodos heredados de `JpaRepository` en el puerto + adaptador (sin redeclararlos en la JPA interface).

**YAML:**

```yaml
repositories:
  - aggregate: Category
    bulkOperations: true
    methods: [...]
```

**Java generado** en `CategoryRepository.java`:

```java
// derived_from: bulk-operations
List<Category> saveAll(List<Category> entities);

// derived_from: bulk-operations
List<Category> findAllById(List<UUID> ids);

// derived_from: bulk-operations
long count();
```

**Adaptador:**

```java
@Override
@Transactional
public List<Category> saveAll(List<Category> entities) {
    return jpaRepository.saveAll(entities.stream().map(mapper::toJpa).toList())
        .stream().map(mapper::toDomain).toList();
}

@Override
public List<Category> findAllById(List<UUID> ids) {
    return jpaRepository.findAllById(ids).stream().map(mapper::toDomain).toList();
}

@Override
public long count() {
    return jpaRepository.count();
}
```

Default: `bulkOperations: false`. No contamina el puerto cuando no se necesita.

---

## 15. `findByIdForUpdate` con `@Lock(PESSIMISTIC_WRITE)` (R13)

Convención de naming reservada para lock pesimista en operaciones puntuales (típico en sagas o invariantes que no soportan concurrencia optimista).

**YAML:**

```yaml
methods:
  - name: findByIdForUpdate
    params: [{ name: id, type: Uuid }]
    returns: Inventory?
    derivedFrom: INV-RULE-007
```

**Java generado:**

```java
// derived_from: INV-RULE-007
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("SELECT i FROM InventoryJpa i WHERE i.id = :id")
Optional<InventoryJpa> findByIdForUpdate(@Param("id") UUID id);
```

Imports añadidos automáticamente: `org.springframework.data.jpa.repository.Lock`, `jakarta.persistence.LockModeType`.

---

## 16. `Slice[T]`, `Stream[T]`, `Long`, `Boolean` (R15, R22)

Tipos canónicos adicionales en `returns`:

| Tipo YAML | Tipo Java | Cuándo usarlo |
|---|---|---|
| `Boolean` | `boolean` | `existsBy*` y predicados |
| `Long` | `long` | `count*` con tablas grandes (> 2.1B filas posibles) |
| `Slice[T]` | `org.springframework.data.domain.Slice<T>` | Paginación sin `COUNT(*)` adicional |
| `Stream[T]` | `java.util.stream.Stream<T>` | Procesado batch incremental |

**Ejemplo — count grande:**

```yaml
methods:
  - name: countByEventType
    params: [{ name: eventType, type: String }]
    returns: Long
    derivedFrom: implicit
```

**Java:**

```java
long countByEventType(String eventType);
```

**Ejemplo — Slice (sin overhead de COUNT):**

```yaml
queryMethods:
  - name: feedByUser
    params:
      - { name: userId, type: Uuid }
      - { name: pageable, type: PageRequest }
    returns: Slice[Activity]
```

---

## 17. Auto-derivación desde `domainRules` `uniqueness` (R25)

Por cada `domainRule` `type: uniqueness` con `field` declarado, el generador inyecta automáticamente `findBy{Field}: {Aggregate}?` si no está declarado explícitamente. Esto evita la duplicación obligada entre la regla y el método.

**Opt-out:** `repositories[].autoDerive: false`.

**YAML:**

```yaml
aggregates:
  - name: User
    domainRules:
      - id: USR-RULE-001
        type: uniqueness
        field: email
        errorCode: USER_EMAIL_ALREADY_EXISTS
      - id: USR-RULE-002
        type: uniqueness
        field: username
        errorCode: USER_USERNAME_ALREADY_EXISTS

repositories:
  - aggregate: User
    methods: []   # vacío — el generador inyecta findByEmail y findByUsername
```

**Java generado** (en `UserRepository.java`):

```java
// derived_from: USR-RULE-001
Optional<User> findByEmail(String email);

// derived_from: USR-RULE-002
Optional<User> findByUsername(String username);
```

Si la regla no declara `field`, no se auto-deriva (el generador no infiere). Si el método ya existe declarado, no se duplica.

---

## 18. Schema completo de `repositories[]`

```yaml
repositories:
  - aggregate: <AggregateName>            # requerido — debe existir en aggregates[]
    bulkOperations: <bool>                # opt-in (R11) — expone saveAll/findAllById/count
    autoDerive: <bool>                    # opt-out de R25 (default true)

    queryMethods:                         # listados con paginación y/o filtros
      - name: <camelCase>
        params:
          - name: <camelCase>
            type: <Uuid|String|Email|Decimal|DateTime|Date|Url|Money|Boolean|Long|Integer|String(N)|Enum<X>|List[T]|PageRequest|Aggregate|VO>
            required: <bool>              # default: true
            filterOn: [<field>, ...]      # multi-columna LIKE_CONTAINS
            operator: <EQ|LIKE_CONTAINS|LIKE_STARTS|LIKE_ENDS|GTE|LTE|IN>
        returns: <T|T?|List[T]|Page[T]|Slice[T]|Stream[T]|Int|Long|Boolean|void>
        derivedFrom: <openapi:opId|RULE_ID|implicit>
        defaultSort: { field: <name>, direction: <ASC|DESC> }   # opt-in (R8)
        sortable: [<field>, ...]                                # opt-in (R8)

    methods:                              # CRUD + queries por reglas
      - name: <camelCase>
        params: [{ name, type, required }]
        returns: <ver arriba>
        derivedFrom: <RULE_ID|implicit>
```

### Convenciones de naming reconocidas por el generador

| Patrón | Clasificación | Comportamiento |
|---|---|---|
| `findById` / `save` / `delete(id)` | `skip` | Heredados de `JpaRepository` (no se redeclaran). |
| `findBy{C1}[And{C2}…]` | `derived` | Spring Data deriva la query. Sin `@Query`. |
| `findByIdForUpdate` | `custom` | `@Lock(PESSIMISTIC_WRITE)` + `@Query` explícito. |
| `existsBy{Campo}` | `derived` | Spring Data deriva. Retorno `boolean`. |
| `countBy{Campo}` | `derived` | Spring Data deriva. Soporta qualifiers `NonDeleted`/`Deleted`/`{Status}`/`Non{Status}`. |
| `deleteBy{Campo}` | `custom` | `@Modifying @Transactional @Query` con DELETE JPQL. |
| `saveAll` / `findAllById` / `count()` | `skip` cuando `bulkOperations: true` | Heredados de `JpaRepository`. |
| `delete(id)` con `softDelete: true` en agregado | renombrado | Se materializa como `softDelete(id)` en port + impl + JPQL UPDATE. |

---

## 19. Limitaciones (lo que sigue NO soportado)

- **R4 — Publicación de eventos post-commit u outbox automático.** Los eventos se publican aún sincrónicamente tras `save`. Resolver requiere extender `system.yaml` con `eventPublishing.strategy: outbox|after-commit`.
- **R6 — `findByIdIncludingDeleted`.** Acceso a filas soft-deleted (admin/restore/audit) requiere extender el schema de `aggregate.softDelete` con `exposeDeleted: true`.
- **R12 — Proyecciones DTO + `@EntityGraph`.** No se puede declarar `projection: SomeDto` ni `fetchStrategy: { children: [...] }` para evitar N+1. El generador siempre carga el agregado completo.
- **IDs no-UUID** (Long, String, composite). Diferido — la plantilla asume `JpaRepository<T, UUID>`.
- **Paginación con cursor (`KeysetPagination`).** Solo se soporta offset-based vía `Pageable` o `page+size`.

Estas limitaciones están listadas en el §0 de [analisis/repositories-analisis.md](../analisis/repositories-analisis.md) como _diferidas_ por requerir extensiones de schema fuera del alcance de la remediación de `repositories[]`.
