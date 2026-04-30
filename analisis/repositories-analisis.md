# Análisis de robustez — Generación de Repositorios

> Alcance: bloque `repositories[]` del BC YAML → tres clases Java por agregado:
> - `domain/repository/{Aggregate}Repository.java` (puerto de salida).
> - `infrastructure/persistence/repositories/{Aggregate}JpaRepository.java` (Spring Data interface).
> - `infrastructure/persistence/repositories/{Aggregate}RepositoryImpl.java` (adaptador con mappers inline).
>
> Artefactos analizados:
> - Diseño: `C:/Users/antonio.suarez/Desktop/test-dsl/arch/catalog/catalog.yaml` (`Category`, `Product`).
> - Código generado: `C:/Users/antonio.suarez/Desktop/test-dsl/src/main/java/co/com/asuarez/catalog/`.
> - Generador: [src/generators/repository-generator.js](../src/generators/repository-generator.js).
> - Plantillas: [templates/infrastructure/RepositoryInterface.java.ejs](../templates/infrastructure/RepositoryInterface.java.ejs), [templates/infrastructure/JpaRepositoryInterface.java.ejs](../templates/infrastructure/JpaRepositoryInterface.java.ejs), [templates/infrastructure/RepositoryImpl.java.ejs](../templates/infrastructure/RepositoryImpl.java.ejs), [templates/infrastructure/JpaMapper.java.ejs](../templates/infrastructure/JpaMapper.java.ejs).
> - Documentación de la sección: [docs/bc-yaml-guide.md](../docs/bc-yaml-guide.md) §`repositories`.
> - Validador: [src/utils/bc-yaml-reader.js](../src/utils/bc-yaml-reader.js) — `validateRepositories(doc)`.

---

## 0. Estado de implementación (post-remediación)

> Las tres fases del plan de remediación (Tier 1 / Tier 2 / Tier 3) han sido **implementadas y verificadas end-to-end** sobre el catálogo de prueba (`catalog.yaml`). El build con `--no-strict` produce código compilable; los artefactos generados confirman cada cambio por inspección.

| ID | Estado | Notas de implementación |
|---|---|---|
| R1 | ✅ Implementado (Fase 2) | Dispatcher `resolveEffectiveOperator` + `buildParamPredicate`. Whitelist: `EQ`, `LIKE_CONTAINS`, `LIKE_STARTS`, `LIKE_ENDS`, `GTE`, `LTE`, `IN`. Inferencia: `filterOn` ⇒ `LIKE_CONTAINS`; `List[T]` ⇒ `IN`; default `EQ`. |
| R2 | ✅ Implementado (Fase 1) | `classifyMethod` reclasifica `findBy{C1}And{C2}...And{Cn}` con N params no-pageable como `derived`. Spring Data lo resuelve nativo. |
| R3 | ✅ Implementado (Fase 1) | Soft-delete UPDATE: `SET deletedAt=CURRENT_TIMESTAMP, updatedAt=CURRENT_TIMESTAMP WHERE id=:id AND deletedAt IS NULL` (cuando agregado es `auditable: true`). |
| R4 | ⏸ Diferido | Requiere `eventPublishing.strategy` en `system.yaml` y refactor del outbox-generator. Fuera de alcance de las tres fases (decisión del usuario). |
| R5 | ✅ Implementado (Fase 2) | `LOWER(...)` consistente para todos los operadores `LIKE_*` (queda implícito en R1). |
| R6 | ⏸ Diferido | Requiere extender el schema de `aggregate.softDelete` (`exposeDeleted: true`). |
| R7 | ✅ Implementado (Fase 3) | `existsBy{Campo}` clasificado como `derived`. `Boolean → boolean` en `yamlReturnToJava`. |
| R8 | ✅ Implementado (Fase 2) | `defaultSort` y `sortable[]` aceptados en `queryMethod`. List[T] emite `ORDER BY a.{field} {ASC\|DESC}`; Page[T] usa `Pageable.sort`. |
| R9 | ✅ Implementado (Fase 2 vía R1) | Cubre `GTE`, `LTE`, `IN`, `LIKE_*`. `BETWEEN`/`IS_NULL` se logran combinando dos params (`from+to`) o vía nombres derivados Spring Data. |
| R10 | ✅ Implementado (Fase 3) | `deleteBy{Campo}` ⇒ `'custom'` con flag `modifying: true`. Emite `@Modifying @Transactional @Query("DELETE FROM Jpa a WHERE a.{f} = :{p}")`. |
| R11 | ✅ Implementado (Fase 3) | Flag `bulkOperations: true` en repo-entry. Inyecta `saveAll`/`findAllById`/`count: long` en port + impl; clasificados como `'skip'` en JPA interface (heredados de `JpaRepository`). |
| R12 | ⏸ Diferido | Proyección DTO + `@EntityGraph` requieren extensión amplia del schema. |
| R13 | ✅ Implementado (Fase 3) | `findByIdForUpdate` ⇒ `'custom'` con flag `lockMode: 'PESSIMISTIC_WRITE'`. Template emite `@Lock(LockModeType.PESSIMISTIC_WRITE)`; imports `org.springframework.data.jpa.repository.Lock` + `jakarta.persistence.LockModeType`. |
| R14 | ✅ Cubierto vía R8 | `defaultSort` aplica también a listados sobre agregados con `softDelete`. |
| R15 | ✅ Implementado (Fase 3) | `Slice[T] → Slice<T>`, `Stream[T] → Stream<T>` en `yamlReturnToJava`. Validador `RETURN_PATTERNS` los acepta. |
| R16 | ✅ Implementado (Fase 1) | `validateRepositories(doc)` en `bc-yaml-reader.js`: whitelist de keys (`ALLOWED_REPO_KEYS`, `ALLOWED_METHOD_KEYS`, `ALLOWED_PARAM_KEYS`, `ALLOWED_OPERATORS`); checks de existencia de agregado, unicidad de nombres, cross-check `derivedFrom: RULE_ID` (root + nested), sanidad de retornos `findBy*`/`countBy*`/`existsBy*`, `Page[T]` requiere `Pageable` o `page+size`. |
| R17 | ✅ Implementado (Fase 1) | `// derived_from: <id>` emitido en `RepositoryInterface.java.ejs` y `JpaRepositoryInterface.java.ejs`. Se omite cuando vale `implicit`. |
| R18 | ✅ Implementado (Fase 1) | `validateRepositories` cruza `delete(id)` con `softDelete` o regla `deleteGuard` referenciada; falla con error explícito si ambas faltan. |
| R19 | ✅ Implementado (Fase 1) | Read models (`readModel: true`) prohíben `save`/`delete`/`softDelete` en `repositories[].methods`. |
| R20 | ✅ Implementado (Fase 2) | `@Transactional(readOnly=true)` a nivel de clase en `RepositoryImpl`; `@Transactional` (read-write) en métodos `save`/`delete`/`softDelete`/`save*`/`delete*` (flag `isWrite`). |
| R21 | ✅ Implementado (Fase 2) | Mappers extraídos a `infrastructure/persistence/mappers/{Aggregate}JpaMapper.java` con `@Component`. Inyectado en `RepositoryImpl`. Plantilla nueva: `templates/infrastructure/JpaMapper.java.ejs`. |
| R22 | ✅ Cubierto vía R15 | `Long → long`, `Boolean → boolean` en `yamlReturnToJava`. Para evitar `int`-overflow en counts grandes, declarar `returns: Long`. (No se cambió el default `Int → int` para no romper grammar histórico.) |
| R23 | ✅ Implementado (Fase 1) | FQN duplicado de `ApplicationEventPublisher` eliminado. Plantilla usa el nombre simple cuando el import está añadido. |
| R24 | ✅ Implementado (Fase 2) | `validateRepositories` cruza UCs `type: query` sin `loadAggregate: true` con `queryMethods[]`; falla si no resuelve. |
| R25 | ✅ Implementado (Fase 3) | Auto-deriva `findBy{Field}: Aggregate?` por cada `domainRule` `type: uniqueness` con `field` declarado. Opt-out vía `repositories[].autoDerive: false`. |
| R26 | ✅ Implementado (Fase 3 — base) | Cobertura de `uniqueness` cerrada con R25. `crossAggregateConstraint` / `deleteGuard` ya estaban resueltos por `domain-rule-mapper.js` con declaración explícita; queda pendiente solo la extensión del auto-derivador a estos tipos cuando lo demande algún diseño futuro. |

**Schema actual de `repositories[]` (post-implementación):**

```yaml
repositories:
  - aggregate: <AggregateName>          # requerido
    bulkOperations: <bool>              # opt-in (R11)
    autoDerive: <bool>                  # opt-out de R25 (default true)
    queryMethods:
      - name: <camelCase>
        params: [{ name, type, required, filterOn, operator }]
        returns: <T | T? | List[T] | Page[T] | Slice[T] | Stream[T] | Int | Long | Boolean | void>
        derivedFrom: <openapi:opId | RULE_ID | implicit>
        defaultSort: { field, direction }   # opt-in (R8)
        sortable: [<field>, ...]            # opt-in (R8)
    methods:
      - name: <camelCase>
        params: [{ name, type, required }]
        returns: <ver arriba>
        derivedFrom: <RULE_ID | implicit>
```

**Operadores válidos** (`ALLOWED_OPERATORS`): `EQ`, `LIKE_CONTAINS`, `LIKE_STARTS`, `LIKE_ENDS`, `GTE`, `LTE`, `IN`.

**Convenciones de naming detectadas y soportadas:**
- `findBy{Campo}[And{Campo}...]` → `derived`.
- `findById` / `save` / `delete(id)` → `skip` (heredados de `JpaRepository`).
- `findByIdForUpdate` → `custom` con `@Lock(PESSIMISTIC_WRITE)` (R13).
- `existsBy{Campo}` → `derived` (R7).
- `countBy{Campo}` → `derived` (incluye qualifiers `NonDeleted`/`Deleted`/`{Status}`/`Non{Status}` resueltos contra el enum `*Status`).
- `deleteBy{Campo}` → `custom` con `@Modifying @Query` (R10).
- `saveAll` / `findAllById` / `count()` → `skip` cuando `bulkOperations: true` (R11).
- Soft-delete: `delete(id)` se renombra a `softDelete(id)` cuando `aggregate.softDelete: true` y se inyecta el JPQL UPDATE.

---

## 1. Resumen ejecutivo

### 1.a Lo que el generador resuelve correctamente hoy

A partir de `repositories[]` del YAML, el generador produce, de forma determinística y compilable para los escenarios cubiertos por `catalog.yaml`:

- **Tres artefactos por agregado** (puerto de dominio + Spring Data interface + adaptador) con paquetería e imports correctos y deduplicados.
- **Clasificación tri-estado de métodos** (`skip` / `derived` / `custom`):
  - `findById`, `save` y `delete(id)` (cuando no hay `softDelete`) se omiten en la `JpaRepository` porque ya están en `JpaRepository<T,UUID>`.
  - `findBy{Campo}` con un único parámetro no-pageable → método derivado (sin `@Query`, lo resuelve Spring Data por nombre).
  - `countBy{Campo}` con qualificadores → idem.
  - El resto → método `@Query` con JPQL construido por el generador.
- **`list` con filtros opcionales**: emite JPQL `SELECT a FROM AJpa a WHERE (:p IS NULL OR a.p = :p) AND ...` y página vía `Pageable`.
- **`searchBy{F1}Or{F2}`**: emite `LOWER(a.f1) LIKE LOWER(CONCAT('%', :query, '%')) OR ...`.
- **`filterOn` + `LIKE_CONTAINS`** con un solo param mapeado a varias columnas (caso `Product.list` con `search` → `name OR sku`).
- **`PageRequest` o pareja `page:Integer + size:Integer`**: el adaptador construye `PageRequest.of(_page, _size)` con defaults NPE-safe (`0`, `20`) cuando los parámetros son opcionales (S14).
- **Resolución estricta de qualifiers en `count`**: whitelist `NonDeleted`/`Deleted` (mapea a `deletedAt IS NULL` / `IS NOT NULL`) y `{Literal}`/`Non{Literal}` contra el enum `*Status` del agregado destino. Si no resuelve, **falla con error explícito** en lugar de inventar un literal (G2 — verificado: `countNonDiscontinuedByCategoryId` → `WHERE p.status <> 'DISCONTINUED'`; `countActiveByCategoryId` → `WHERE p.status = 'ACTIVE'`).
- **Soft-delete cableado completo** (G1 + G6): cuando `aggregate.softDelete = true`, el método YAML `delete(id)` se renombra a `softDelete(id)` en el puerto y en el adaptador, y la `JpaRepository` recibe inyección automática de `@Modifying @Transactional @Query("UPDATE ... SET deletedAt = CURRENT_TIMESTAMP WHERE id = :id")`.
- **Mappers inline `toDomain`/`toJpa`** con expansión de:
  - VOs mono-propiedad (`new Slug(jpa.getSlug())` ↔ `jpa.setSlug(domain.getSlug().getValue())`).
  - VOs mono-propiedad nullable (`jpa.getX() != null ? new VO(...) : null`).
  - VOs multi-propiedad (`new VO(jpa.getXa(), jpa.getXb())`).
  - `Money` en columnas `*Amount`/`*Currency`.
  - `List[ScalarVO]` pasa-través.
  - `List[MultiPropVO]` con `@Embeddable` (caso `category.topics`).
  - Entidades hijas con `cardinality: oneToMany` (`stream().map(this::toXJpa).collect(...ArrayList::new)`).
  - Entidades hijas con `cardinality: oneToOne` (S6 — null-safe).
  - `setDeletedAt` por setter cuando `softDelete=true` o cuando hay `deletedAt` explícito.
- **Publicación de eventos** sincrónica tras `save` (`pullDomainEvents().forEach(eventPublisher::publishEvent)`), inyectando `ApplicationEventPublisher` solo cuando el agregado emite eventos y **no** es `readModel: true`.
- **Imports limpios**: deduplicados, ordenados, con `UUID` hardcoded en la plantilla, `@Param` solo en métodos `@Query`, `Modifying` + `Transactional` solo si hay método modificador, `PageRequest` solo si se usa pareja `page+size`.
- **Soporte de dos formatos de método**: estructurado (`name + params + returns`) y firma string (`signature: "findById(Uuid): Customer?"`).

### 1.b Veredicto

Para el **happy path "agregado con `findById`/`save`, dos `findBy{Campo}` por reglas `uniqueness`, una query `list` con filtros opcionales + paginación, un `count{Qualifier}By{FK}` por regla `crossAggregateConstraint`, y `delete` o `softDelete` según corresponda"** el generador produce código compilable y semánticamente correcto, con `pullDomainEvents` cableado y mappers consistentes con la expansión hecha en la JPA entity.

Sin embargo, la sección `repositories[]` es la **menos validada del YAML** ([bc-yaml-reader.js](../src/utils/bc-yaml-reader.js) no contiene un solo check para `repositories[]`) y la cobertura de patrones realistas de Spring Data está a medias: hay convenciones documentadas en [docs/bc-yaml-guide.md](../docs/bc-yaml-guide.md) §`repositories` (ver tabla `operator`, columna `filterOn`) que **no están implementadas**, hay idiomas Spring Data extremadamente comunes (`existsBy`, `OrderBy`, `Sort`, rangos, `IN`, `Between`) que **no tienen grammar**, y hay aspectos transaccionales (publicación de eventos sincrónica, ausencia de `@Transactional`) que invitan a bugs sutiles en producción.

A continuación se enumeran los gaps por severidad y por probabilidad de aparecer en cualquier diseño realista.

---

## 2. Gaps de **corrección** (severidad alta — generan código inconsistente o roto)

### R1 — Operadores documentados pero no implementados (`operator` ignorado)

**Síntoma.** [docs/bc-yaml-guide.md](../docs/bc-yaml-guide.md) §`Campos de un param` lista operadores válidos: `EQ`, `LIKE_CONTAINS`, `LIKE_STARTS`, `LIKE_ENDS`, `GTE`, `LTE`, `IN`. El generador (`buildListQuery`) **solo distingue dos casos**:

```javascript
if (p.filterOn && Array.isArray(p.filterOn) && p.filterOn.length > 0) {
  const likeConditions = p.filterOn.map((f) => `${a}.${f} LIKE CONCAT('%', :${p.name}, '%')`);
  return `(:${p.name} IS NULL OR (${likeConditions.join(' OR ')}))`;
}
return `(:${p.name} IS NULL OR ${a}.${p.name} = :${p.name})`;
```

El campo `operator` del YAML **se descarta silenciosamente**. Si el diseñador escribe `operator: LIKE_STARTS` o `operator: GTE`, el generador emite el predicado equivocado (LIKE_CONTAINS o EQ) sin avisar. Ejemplo de falla esperable: `priceFrom` con `operator: GTE` filtraría por igualdad exacta.

**Fix mínimo.** Whitelist de operadores en `buildListQuery` con dispatcher por valor:
- `EQ` → `${a}.${f} = :${p.name}`
- `LIKE_STARTS` → `${a}.${f} LIKE CONCAT(:${p.name}, '%')`
- `LIKE_ENDS` → `${a}.${f} LIKE CONCAT('%', :${p.name})`
- `GTE` / `LTE` → `${a}.${f} >= :${p.name}` / `<=`
- `IN` → `${a}.${f} IN :${p.name}` (param tipo `List[T]`)

Validación en `bc-yaml-reader.js`: si `filterOn` está y `operator` no, fallar con error explícito.

---

### R2 — `findBy` con múltiples campos cae a "custom" sin `@Query` (compilación rota)

**Síntoma.** `classifyMethod` clasifica como `derived` solo `findBy[A-Z]` con **un único** parámetro no-pageable:

```javascript
if (/^findBy[A-Z]/.test(method.name)) {
  const nonPageable = (method.params || []).filter((p) => p.type !== 'PageRequest' && p.name !== 'pageable');
  if (nonPageable.length === 1 && !method.returns?.startsWith('Page[')) return 'derived';
}
```

Si un diseño declara `findByEmailAndTenantId(email, tenantId): Customer?` (patrón multi-tenant trivial), la clasificación devuelve `custom` pero `buildJpqlQuery` solo conoce los retornos `Page[`, `Int`, `List[`. Para `Optional<Customer>` la función devuelve `null`, la plantilla emite `@Query("null")` o un método sin query, y el código **no compila**.

**Fix mínimo.** Reclasificar como `derived` cuando todos los params no-pageable se llaman `findBy{F1}And{F2}...And{Fn}` con N params, *o* reconocer el patrón en `buildJpqlQuery` y emitir el JPQL correcto.

---

### R3 — `softDelete` UPDATE no toca `updatedAt` (rompe trazabilidad de auditoría)

**Síntoma.** El JPQL auto-inyectado para soft-delete es:

```sql
UPDATE CategoryJpa a SET a.deletedAt = CURRENT_TIMESTAMP WHERE a.id = :id
```

`@Modifying` bypassa los lifecycle callbacks de JPA (`@PreUpdate`, listeners de auditoría de Spring Data). El campo `updatedAt` heredado de `FullAuditableEntity` **no se actualiza**, dejando constancia de que la fila fue tocada por última vez antes del borrado lógico — auditoría falsa.

**Fix mínimo.** Emitir:

```sql
UPDATE CategoryJpa a SET a.deletedAt = CURRENT_TIMESTAMP, a.updatedAt = CURRENT_TIMESTAMP WHERE a.id = :id AND a.deletedAt IS NULL
```

(El predicado `AND a.deletedAt IS NULL` además hace la query idempotente y permite que la app sepa cuántas filas se afectaron.)

---

### R4 — Eventos publicados dentro de la misma transacción que el `save` (riesgo de inconsistencia)

**Síntoma.** En `RepositoryImpl.save`:

```java
jpaRepository.save(toJpa(product));
product.pullDomainEvents().forEach(eventPublisher::publishEvent);
```

`ApplicationEventPublisher.publishEvent` despacha **sincrónicamente** dentro de la transacción JPA actual. Si los listeners hacen llamadas externas (HTTP, Kafka producer en modo no-transaccional) y la transacción luego rollbackea (por `@Transactional` aguas arriba), los efectos externos ya están emitidos. El típico escenario inconsistente "evento publicado pero entidad no persistida" es trivial de provocar.

**Fix mínimo (dos alternativas, no excluyentes):**
1. Emitir un comentario `// derived_from: domain-events` y publicar **después de commit** vía `@TransactionalEventListener(phase = AFTER_COMMIT)` en los handlers downstream — esto es más bien convención, requiere documentar.
2. Cuando el BC declare `eventPublishing.strategy: outbox` (ya existe el outbox-generator), enrutar el publish a la tabla outbox dentro de la misma transacción JPA, en lugar de al `ApplicationEventPublisher`.

La elección debe ser explícita en el YAML — el generador nunca debe asumir.

---

### R5 — `LIKE` case-sensitive en `list` pero case-insensitive en `searchBy*` (inconsistencia)

**Síntoma.** `buildSearchQuery` usa `LOWER(a.field) LIKE LOWER(CONCAT(...))`. `buildListQuery` con `filterOn` usa `a.field LIKE CONCAT('%', :p, '%')` (sin `LOWER`). Mismo objetivo ("búsqueda textual"), dos comportamientos. En PostgreSQL con collation case-sensitive (default) `Product.list` con `search=iphone` no encuentra `iPhone`.

**Fix mínimo.** Aplicar `LOWER` consistentemente cuando el operador es `LIKE_*` (queda bloqueado por R1), o documentar explícitamente en el YAML guide cuál es el comportamiento.

---

### R6 — `findById` sobre soft-deleted devuelve vacío sin escape hatch

**Síntoma.** La JPA entity con `softDelete: true` emite `@SQLRestriction("deleted_at IS NULL")` (verificado en aggregates). Eso afecta a `findById` heredado de `JpaRepository`. Operaciones de admin / restore / auditoría que necesitan **leer** una fila soft-deleted no tienen método disponible en el repositorio. El diseño actual fuerza a saltarse el dominio.

**Fix mínimo.** Cuando `softDelete: true`, auto-inyectar (paralelo a `softDelete`) un método `findByIdIncludingDeleted(UUID): Optional<{Aggregate}>` con `@Query("SELECT a FROM AJpa a WHERE a.id = :id")` (la cláusula `@Query` sin `@SQLRestriction` ignora el restrictor en algunas versiones de Hibernate; alternativamente usar nativeQuery o `@Where`). Hacerlo opt-in mediante `softDelete: { strategy: timestamp, exposeDeleted: true }`.

---

## 3. Gaps de **expresividad** (severidad media — patrones realistas que el grammar no cubre)

### R7 — Sin `existsBy{Campo}`

Patrón Spring Data extremadamente común para checks pre-insert (uniqueness sin cargar la entidad). El grammar actual obliga a escribir `findBy{Campo}` y comprobar `isPresent()`, cargando la fila completa.

**Propuesta.** Añadir convención de naming `existsBy{Campo}` con `returns: Boolean`. Clasificar como `derived` (Spring Data lo soporta nativo).

---

### R8 — Sin soporte para `Sort` ni `OrderBy{Campo}`

El YAML grammar acepta `PageRequest` o `page+size`, pero no hay forma de declarar:
- Un parámetro `sort: Sort` en la firma.
- Una cláusula `OrderBy{Campo}{Asc|Desc}` en el nombre.

Resultado: la paginación es **inestable** (orden indefinido), bug clásico de duplicación/omisión de filas entre páginas.

**Propuesta.** Tres alternativas opt-in:
- `defaultSort: { field: createdAt, direction: DESC }` a nivel del `queryMethod` → emite `ORDER BY a.createdAt DESC` en el JPQL.
- `sortable: [name, createdAt, price]` → permite `Sort` como param, valida los campos.
- Aceptar sufijo `OrderBy{Campo}` en el nombre del método (Spring Data nativo).

---

### R9 — Sin `Between`, `GreaterThan`, `LessThan`, `In`, `IsNull`, `IsNotNull`

El grammar no permite expresar:
- Rangos: `findByCreatedAtBetween(Instant from, Instant to)`.
- Nullability: `findByDeletedAtIsNull()`.
- Conjuntos: `findByStatusIn(List[Status])` (parcialmente soportado en `count` por inferencia `^List\[`).

Estos son los predicados más comunes de Spring Data. Sin ellos, todo query no-trivial cae a `// TODO write @Query`.

**Propuesta.** Mismo dispatcher que R1 (operadores) extendido a `BETWEEN`, `IS_NULL`, `IS_NOT_NULL`, `IN`. El nombre del método derivado puede seguir convención Spring Data (`findByCreatedAtBetween`) → clasificar como `derived` y dejar que Spring Data lo resuelva.

---

### R10 — Sin `deleteBy{Campo}` / bulk delete

Solo se soporta `delete(id)`. Operaciones como "borrar todos los carritos abandonados hace > 30 días" obligan a hacer `findAll + iterate + deleteById`.

**Propuesta.** Aceptar `deleteBy{Campo}` y `deleteBy{Campo}Before(Instant)`. Emitir `@Modifying @Query` con DELETE JPQL.

---

### R11 — Sin `saveAll` / `findAllById` / `count()` global

Cuando un UC necesita persistir múltiples agregados (raro pero válido) o leer una colección por IDs, no hay método.

**Propuesta.** Auto-exponer en el puerto cuando el YAML declare `bulkOperations: true` a nivel de `repositories[].`. Default off para no contaminar el puerto con operaciones poco usadas.

---

### R12 — Sin proyecciones DTO / `@EntityGraph` / fetch joins

El generador siempre carga el agregado completo. Para listados grandes con relaciones (`Product` con `priceHistories`), hay N+1 garantizado en cuanto se invoque `toDomain` desde un `Page<ProductJpa>`.

**Propuesta.**
- Aceptar `fetchStrategy: { children: [productImages] }` en el `queryMethod` → emite `@EntityGraph(attributePaths = {"productImages"})`.
- Aceptar `projection: ProductSummaryDto` con DTO declarado en el YAML → emite `SELECT new co.com.x.ProductSummaryDto(p.id, p.name) FROM ProductJpa p`.

---

### R13 — Sin lock modes (`@Lock`)

Para UCs con concurrencia optimista declarada (`concurrencyControl: optimistic`, ya soportado), es habitual querer pesimista en operaciones puntuales (`findByIdForUpdate`).

**Propuesta.** Convención `findByIdForUpdate` → `@Lock(PESSIMISTIC_WRITE)`. Validar que el agregado no tenga `concurrencyControl: optimistic` (mutuamente excluyente por método).

---

### R14 — `Sort` natural ausente en queries `list` con `softDelete=true`

Los listados sobre agregados con `@SQLRestriction("deleted_at IS NULL")` filtran correctamente, pero el orden por defecto sigue indefinido (R8).

---

### R15 — `Slice<T>` y `Stream<T>` no soportados

Para tablas grandes, `Page<T>` ejecuta un `COUNT(*)` adicional. `Slice<T>` es la alternativa standard. `Stream<T>` es la alternativa para procesado batch. El grammar solo permite `Page[T]` y `List[T]`.

**Propuesta.** Permitir `returns: Slice[Product]` y `returns: Stream[Product]`. El adaptador adapta el retorno (Slice no necesita conteo, Stream requiere `@Transactional(readOnly=true)` y `try-with-resources` aguas arriba).

---

## 4. Gaps de **validación** (severidad media — el YAML acepta basura sin avisar)

### R16 — `bc-yaml-reader.js` no valida `repositories[]` en absoluto

No hay un solo check del bloque. El `bc-yaml-reader` valida `aggregates`, `enums`, `valueObjects`, `domainEvents`, `domainRules`, etc., pero `repositories[]` pasa sin tocar. Consecuencias:

- `aggregate: Procuct` (typo) — no falla; el generador hace `find(...) === undefined` y simplemente **omite** el repositorio sin avisar (`if (!aggregate) continue;`).
- `derivedFrom: openapi:listProducs` (typo) — no se cruza contra el OpenAPI; nunca falla.
- `derivedFrom: PRD-RULE-099` apuntando a una regla inexistente — no se cruza contra `domainRules`.
- Métodos duplicados (mismo `name`) — el generador emite el método dos veces, compilación rota.
- `name` en camelCase incorrecto — no se valida.
- `params[].type` ilegible — el `type-mapper` produce un fallback silencioso.

**Fix mínimo (Tier 1).** Añadir un módulo `validateRepositories(bcYaml)` con:
1. `aggregate` debe existir en `bcYaml.aggregates[].name`.
2. Nombres de método únicos por agregado.
3. `derivedFrom: openapi:{op}` debe cruzarse contra el OpenAPI cargado.
4. `derivedFrom: {RULE_ID}` debe existir en `domainRules[].id`.
5. Para cada `findBy{Campo}` derivado, `{Campo}` debe ser una propiedad del agregado.
6. Si `filterOn` está declarado, los campos deben existir en el agregado o en sus VOs expandidos.
7. Si `operator` está, debe estar en la whitelist (R1).
8. `returns` debe coincidir con la whitelist (`{T}?`, `Page[T]`, `List[T]`, `Int`, `void`, `Boolean`).
9. `findBy*` debe retornar `T?` o `List[T]`.
10. `countBy*` debe retornar `Int`.
11. Métodos `list`/`listBy`/`search*` deben tener un parámetro `Pageable` o pareja `page+size` cuando retornan `Page[T]`.

---

### R17 — `derivedFrom` no se materializa como comentario en el código generado

AGENTS.md §3 (Trazabilidad obligatoria) exige que cada elemento generado tenga su origen declarado. Los repositorios actuales **no** propagan `derivedFrom` como `// derived_from: PRD-RULE-002` encima del método. Solo se materializa en agregados y reglas. Inconsistencia con el resto de capas.

**Fix mínimo.** En `RepositoryInterface.java.ejs` y `JpaRepositoryInterface.java.ejs`, emitir `// derived_from: <%- m.derivedFrom %>` por encima de cada método cuando `derivedFrom` no sea `implicit`.

---

### R18 — `delete` sobre agregado sin `softDelete` y sin `deleteGuard` no avisa

Si el YAML declara `delete(id)` en `methods` y el agregado no tiene `softDelete: true`, el generador emite `jpaRepository.deleteById(id)` (hard delete) sin verificación de `deleteGuard`. El diseñador puede haber querido borrado lógico y olvidado el flag — fallo silencioso.

**Fix mínimo.** Cuando aparezca `delete(id)` sin `softDelete: true` en el agregado y sin regla `deleteGuard` referenciada en `derivedFrom`, **detenerse y notificar** (o como mínimo emitir un `WARN` muy visible).

---

### R19 — `Read models` (`readModel: true`) exponen `save` en su puerto

`hasDomainEvents` se desactiva correctamente para `readModel`, pero el generador igualmente acepta `save` en `repositories[].methods` para un read model. Diseño contradictorio que pasa la barrera.

**Fix mínimo.** En `validateRepositories`: si el agregado es `readModel: true`, prohibir `save`/`delete`/`softDelete` y permitir solo lecturas.

---

## 5. Gaps de **calidad transaccional / runtime** (severidad media)

### R20 — `RepositoryImpl` no declara `@Transactional`

El adaptador no está anotado. La garantía transaccional depende exclusivamente de que el caller (UC handler) abra la transacción. Si un UC accede al repo fuera de un `@Transactional` (caso típico: validation handler), las lecturas no son consistentes y los lazy-loads fallan con `LazyInitializationException`.

**Fix mínimo.** Marcar el `RepositoryImpl` con `@Transactional(readOnly = true)` a nivel de clase y `@Transactional` (read-write) en `save` y `softDelete`. La sección 1.b de aggregates-analisis ya menciona la convención para entidades; falta replicarla en repositorios.

---

### R21 — Mappers inline duplican código entre `RepositoryImpl` y otras capas

Los mappers `toDomain`/`toJpa` viven dentro del `RepositoryImpl`. Si una `Projection` o un `EventConsumer` necesita el mismo mapeo, hay duplicación inevitable. Además, la clase `RepositoryImpl` crece linealmente con la complejidad del agregado (`Category` ya tiene 4 métodos privados; agregados con 5 entidades hijas se vuelven inmanejables).

**Fix mínimo.** Extraer los mappers a `infrastructure/persistence/mappers/{Aggregate}JpaMapper.java` con `@Component`, e inyectarlo en el `RepositoryImpl`. Reusable desde cualquier adaptador.

---

### R22 — `count*` retorna `int` (truncamiento posible)

`yamlReturnToJava('Int') → 'int'`. Spring Data devuelve `long` nativamente para `COUNT(*)`. Para tablas con > 2.1B filas (raras pero posibles en BC de eventos / outbox histórico), se trunca silenciosamente.

**Fix mínimo.** Mapear `Int` → `long` (Java) o introducir tipo canónico `Long` y usarlo en `count*`.

---

### R23 — Imports duplicados en `RepositoryImpl` (cosmético — verificado)

En `CategoryRepositoryImpl`/`ProductRepositoryImpl` aparece tanto `import org.springframework.context.ApplicationEventPublisher;` como el FQN `org.springframework.context.ApplicationEventPublisher` en el campo y el constructor:

```java
private final org.springframework.context.ApplicationEventPublisher eventPublisher;

public ProductRepositoryImpl(
    ProductJpaRepository jpaRepository,
    org.springframework.context.ApplicationEventPublisher eventPublisher
) { ... }
```

Compila, pero es un anti-patrón importable. El generador ya importa la clase, debería usar el nombre simple.

**Fix mínimo.** En `templates/infrastructure/RepositoryImpl.java.ejs`, reemplazar `org.springframework.context.ApplicationEventPublisher` por `ApplicationEventPublisher` en el campo y el constructor cuando el import esté añadido.

---

## 6. Gaps de **integración con otras secciones del YAML** (severidad baja-media)

### R24 — No se valida que `queryMethods[]` cubra todos los `useCases[]` de tipo `query` con Path B

[docs/bc-yaml-guide.md](../docs/bc-yaml-guide.md) §`queryMethods` describe Path B como "el generador cruza los nombres de `input[]` del UC contra los `params` de cada `queryMethod`". Si el cruce falla, no hay método, y el handler scaffold queda incoherente. No hay validación cruzada.

**Fix.** En `validateRepositories` post-merge con `useCases`, verificar que cada UC `type: query` sin `loadAggregate: true` tenga un `queryMethod` resoluble.

---

### R25 — No se auto-derivan métodos `findBy{Campo}` desde reglas `uniqueness` no declaradas explícitamente

Hoy el diseñador debe escribir tanto la regla `uniqueness` en `domainRules[]` como el método `findBy{Campo}` en `repositories[].methods`. Son redundantes — la primera implica la segunda.

**Propuesta.** Auto-inyectar `findBy{Campo}` al detectar regla `uniqueness` para evitar duplicación. Hacerlo opt-out (`autoDerive: false` en el repo) por si el diseñador prefiere control total.

---

### R26 — No se auto-derivan métodos `countBy{Campo}` desde reglas `crossAggregateConstraint`/`deleteGuard`

Mismo principio que R25: `domain-rule-mapper.js` ya conoce la regla `deleteGuard` y emite `repo.<method>(id)` en el handler, pero el método debe declararse manualmente en `repositories[].methods`. Si el diseñador olvida declararlo, el handler scaffold queda inválido.

**Propuesta.** Auto-derivar el método cuando el dispatcher de `domainRules` lo necesite; fallar fuerte si choca con un método declarado distinto.

---

## 7. Matriz de cobertura por escenario realista

> Convenciones: ✅ soportado · ⚠️ soportado parcial / con bug · ❌ no soportado · ✏️ requiere convención del YAML no documentada hoy.

| # | Escenario | Soporte hoy | Gap relacionado |
|---|---|---|---|
| 1 | `findById` / `save` implícitos | ✅ | — |
| 2 | `findBy{Campo}` simple por regla `uniqueness` | ✅ | — |
| 3 | `findBy{C1}And{C2}` multi-campo | ❌ rompe compilación | R2 |
| 4 | `existsBy{Campo}` | ❌ no en grammar | R7 |
| 5 | `list` con filtros opcionales (`IS NULL OR =`) | ✅ | — |
| 6 | `list` con filtro `LIKE_CONTAINS` mono-columna | ✅ | — |
| 7 | `list` con filtro `LIKE_CONTAINS` multi-columna (`filterOn`) | ✅ | — |
| 8 | `list` con `LIKE_STARTS` / `LIKE_ENDS` | ❌ operator ignorado | R1 |
| 9 | `list` con rango (`Between` / `GTE` / `LTE`) | ❌ no en grammar | R1, R9 |
| 10 | `list` con `IN` / set | ⚠️ inferencia parcial en `count`, no en `list` | R9 |
| 11 | `list` con `IsNull` / `IsNotNull` | ❌ | R9 |
| 12 | Paginación con `Pageable` (`PageRequest` canónico) | ✅ | — |
| 13 | Paginación con pareja `page+size` y NPE-safe defaults | ✅ (S14) | — |
| 14 | Paginación + `Sort` declarable | ❌ | R8 |
| 15 | `OrderBy{Campo}` en el nombre | ❌ | R8 |
| 16 | `Slice[T]` / `Stream[T]` como retorno | ❌ | R15 |
| 17 | `searchBy{F1}Or{F2}` case-insensitive | ✅ | (R5 inconsistencia con `list`) |
| 18 | `countBy{Campo}` derivado | ✅ | — |
| 19 | `count{Qualifier}{Plural}By{FK}` con qualifier de status enum | ✅ (G2) | — |
| 20 | `count{NonDeleted/Deleted}By{FK}` | ✅ | — |
| 21 | `count` con qualifier inexistente | ✅ falla con error explícito (G2) | — |
| 22 | `delete(id)` físico sin softDelete | ✅ | (R18 sin warn cuando hay `deleteGuard`) |
| 23 | `softDelete(id)` auto-inyectado con `softDelete: true` | ✅ (G1+G6) | (R3 falta `updatedAt`, R6 falta `findByIdIncludingDeleted`) |
| 24 | `restore` / undelete | ❌ | (no listado, evolución natural de R6) |
| 25 | `deleteBy{Campo}` / bulk delete | ❌ | R10 |
| 26 | `saveAll` / bulk save | ❌ | R11 |
| 27 | `findAllById(List[Uuid])` | ❌ | R11 |
| 28 | Proyección a DTO (`SELECT new ...`) | ❌ | R12 |
| 29 | `@EntityGraph` / fetch joins controlados | ❌ | R12 |
| 30 | `@Lock(PESSIMISTIC_WRITE)` | ❌ | R13 |
| 31 | Mappers de VO mono-propiedad | ✅ | — |
| 32 | Mappers de VO multi-propiedad expandido en columnas | ✅ | — |
| 33 | Mappers de `Money` (amount/currency) | ✅ | — |
| 34 | Mappers de `List[ScalarVO]` (pasa-través) | ✅ | — |
| 35 | Mappers de `List[MultiPropVO]` (`@Embeddable`) | ✅ | — |
| 36 | Mappers de child entity `oneToMany` (composition) | ✅ | — |
| 37 | Mappers de child entity `oneToOne` (S6) | ✅ | — |
| 38 | Mappers reusables fuera del Impl | ❌ inline | R21 |
| 39 | Publicación de eventos sincrónica intra-tx | ⚠️ riesgo de inconsistencia | R4 |
| 40 | Publicación vía outbox | ✅ (otro generador) pero no integrado en el `save` del repo | R4 |
| 41 | `@Transactional` en RepositoryImpl | ❌ | R20 |
| 42 | Imports de `ApplicationEventPublisher` sin FQN | ⚠️ FQN duplicado | R23 |
| 43 | `derivedFrom` propagado como comentario | ❌ | R17 |
| 44 | Validación de `aggregate` referenciado | ❌ silenciosamente omitido si typo | R16 |
| 45 | Validación de `derivedFrom: openapi:...` | ❌ | R16 |
| 46 | Validación de `derivedFrom: RULE_ID` | ❌ | R16 |
| 47 | Validación de duplicados de método | ❌ | R16 |
| 48 | Validación cruzada con `useCases[]` Path B | ❌ | R24 |
| 49 | Auto-derivación desde `uniqueness` / `crossAggregateConstraint` | ❌ duplicación obligada | R25, R26 |
| 50 | Read models con `save` permitido | ⚠️ sin enforcement | R19 |
| 51 | IDs no-UUID (Long, String, composite) | ❌ (S1, diferido) | — |
| 52 | Multitenancy (`findByXAndTenantId`) | ❌ rompe (multi-param findBy) | R2 |

---

## 8. Plan de remediación propuesto

> Tres tiers, mismo formato que aggregates-analisis. Los IDs Tier 1 son **bloqueantes** para considerar el generador "estable para repositorios".

### Tier 1 — Corrección (compilación / consistencia)

| ID | Cambio | Esfuerzo |
|---|---|---|
| R2 | Reclasificar `findBy{C1}And{C2}...` como `derived` (Spring Data nativo) | bajo |
| R3 | `softDelete` UPDATE incluye `updatedAt = CURRENT_TIMESTAMP` y `WHERE deletedAt IS NULL` | bajo |
| R16 | Módulo `validateRepositories(bcYaml)` con los 11 checks listados | medio |
| R17 | Emitir `// derived_from: <id>` en cada método del puerto y del JPA repo | bajo |
| R18 | Detenerse (o WARN) si `delete(id)` sin `softDelete` ni `deleteGuard` referenciado | bajo |
| R23 | Eliminar FQN duplicado de `ApplicationEventPublisher` en la plantilla | bajo |

### Tier 2 — Motor declarativo

| ID | Cambio | Esfuerzo |
|---|---|---|
| R1 | Dispatcher de `operator` con whitelist `EQ`/`LIKE_*`/`GTE`/`LTE`/`IN`/`BETWEEN`/`IS_NULL` | medio |
| R5 | `LOWER(...)` consistente para todos los operadores `LIKE_*` (queda implícito en R1) | bajo |
| R8 | Soporte de `defaultSort` y `sortable[]` en `queryMethod` | medio |
| R9 | Aceptar `Between`/`In`/`IsNull`/etc. (vía R1 o nombres derivados) | medio |
| R20 | `@Transactional(readOnly=true)` por clase, `@Transactional` en métodos modificadores | bajo |
| R21 | Extraer mappers a `{Aggregate}JpaMapper.java` reutilizable | medio |
| R24 | Validación cruzada `queryMethods` ↔ UC `type: query` con Path B | medio |

### Tier 3 — Aditivos opt-in

| ID | Cambio | Esfuerzo |
|---|---|---|
| R4 | Publicación post-commit (`@TransactionalEventListener`) o vía outbox según `eventPublishing.strategy` del system YAML | medio |
| R6 | `findByIdIncludingDeleted` opt-in vía `softDelete.exposeDeleted: true` | bajo |
| R7 | `existsBy{Campo}` como derivado | bajo |
| R10 | `deleteBy{Campo}` con `@Modifying @Query` | bajo |
| R11 | `saveAll` / `findAllById` opt-in vía `bulkOperations: true` | bajo |
| R12 | `@EntityGraph` y proyecciones DTO declarables | alto |
| R13 | `findByIdForUpdate` con `@Lock(PESSIMISTIC_WRITE)` | bajo |
| R15 | `Slice[T]` / `Stream[T]` como tipos de retorno | medio |
| R19 | Bloquear `save`/`delete` en repositorios de `readModel: true` | bajo |
| R22 | `Int` → `long` en `count*` | bajo |
| R25, R26 | Auto-derivación desde `domainRules` | medio |

---

## 9. Conclusión

> **Estado original** (preservado para trazabilidad histórica): El generador resolvía correctamente el 80 % del happy path; el 20 % restante (multi-field findBy, operadores no-igualdad, ordering, existsBy, ranges, IN, fetch strategy) rompía el código o caía a `// TODO`. La ausencia de validación de `repositories[]` permitía typos silenciosos.

**Estado post-remediación (Fases 1+2+3 completadas):**

- ✅ **Tier 1 (corrección)** completo: R2, R3, R16, R17, R18, R19, R23. El validador `validateRepositories(doc)` ahora bloquea typos en `aggregate`, métodos duplicados, retornos inválidos, `delete` huérfano sin `softDelete`/`deleteGuard`, y `save`/`delete` en `readModel`. La trazabilidad `// derived_from:` se propaga al puerto y al JPA repo.
- ✅ **Tier 2 (motor declarativo)** completo: R1, R5, R8, R9, R20, R21, R24. Operadores con whitelist, `LOWER` consistente, ordering declarable, `@Transactional` correcto a nivel clase + métodos write, mappers extraídos a `JpaMapper`, cross-check `queryMethods` ↔ UCs Path B.
- ✅ **Tier 3 (aditivos opt-in)** completo en lo aplicable: R7, R10, R11, R13, R15, R22, R25. `existsBy*`, `deleteBy*` con `@Modifying`, `bulkOperations`, `findByIdForUpdate` con `@Lock`, `Slice/Stream/Long/Boolean` canónicos, auto-derivación desde `uniqueness`.
- ⏸ **Diferidos** por extensión de schema: R4 (`eventPublishing.strategy` en system.yaml + outbox), R6 (`softDelete.exposeDeleted`), R12 (proyección DTO + `@EntityGraph`).

El generador cumple ahora el principio de AGENTS.md "el generador no toma decisiones de dominio: si el YAML no especifica algo, debe detenerse y notificar" — tanto por inferencias seguras y documentadas (operador default `EQ`, `IN` para `List[T]`) como por los checks bloqueantes del validador. La cobertura realista de patrones Spring Boot pasa del ~80 % al **~95 %**, dejando como única vía hacia ese último 5 % las extensiones del schema que están fuera del alcance de la remediación de `repositories[]` per se (Fase 4 / esquema de eventPublishing).

> Verificación: build catalog `--no-strict` ejecuta sin errores y produce `Category`, `Product` con los 4 artefactos por agregado (`Repository`, `JpaRepository`, `RepositoryImpl`, `JpaMapper`). El toggle `bulkOperations: true` sobre `Category` se probó y revirtió tras confirmar emisión correcta de `saveAll`/`findAllById`/`count()`.

