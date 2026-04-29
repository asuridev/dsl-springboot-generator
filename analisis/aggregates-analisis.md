# Análisis de robustez — Generación de Aggregates

> Alcance: bloque `aggregates[]` del BC YAML → clases Java en `domain/aggregate`, `domain/entity` e `infrastructure/persistence/entities`. También se evalúa el `RepositoryImpl` y la `JpaRepository` en cuanto interactúan con el ciclo de vida del agregado (delete / softDelete / mappers).
>
> Artefactos analizados:
> - Diseño: `C:/Users/antonio.suarez/Desktop/test-dsl/arch/catalog/catalog.yaml` (`Category`, `Product` con entidades hijas `ProductImage`, `PriceHistory`).
> - Código generado: `C:/Users/antonio.suarez/Desktop/test-dsl/src/main/java/co/com/asuarez/catalog/`.
> - Generadores:
>   - [src/generators/aggregate-generator.js](../src/generators/aggregate-generator.js)
>   - [src/generators/jpa-entity-generator.js](../src/generators/jpa-entity-generator.js)
>   - [src/generators/repository-generator.js](../src/generators/repository-generator.js)
> - Plantillas:
>   - [templates/domain/AggregateRoot.java.ejs](../templates/domain/AggregateRoot.java.ejs)
>   - [templates/domain/ChildEntity.java.ejs](../templates/domain/ChildEntity.java.ejs)
>   - [templates/infrastructure/JpaEntity.java.ejs](../templates/infrastructure/JpaEntity.java.ejs)
>   - [templates/infrastructure/JpaChildEntity.java.ejs](../templates/infrastructure/JpaChildEntity.java.ejs)

---

## 1. Resumen ejecutivo

### 1.a Lo que el generador resuelve correctamente hoy

A partir del bloque `aggregates[]` del YAML, el generador produce, de forma determinística y compilable para los escenarios cubiertos por `catalog.yaml`:

- Aggregate root con campos `final` para `id`, getters públicos, sin Lombok, sin setters, sin constructor vacío.
- **Doble constructor**: reconstrucción (todos los campos) + creación privada (sin `id` ni audit).
- **Static factory `create(...)`** parametrizada desde `domainMethods.create.params`, con `// TODO: compute X` para campos `readOnly` no presentes en la firma (caso `slug`).
- **Inicialización automática** de propiedades `readOnly` con `defaultValue`:
  - `generated` → `UUID.randomUUID()`
  - `now()` → `Instant.now()`
  - literal de enum → `EnumType.VALUE`
  - booleano / string literal.
- **Audit fields** (`createdAt`/`updatedAt`) y **soft-delete** (`deletedAt` + getter + `isDeleted()`) inyectados solo si `auditable: true` o `softDelete: true`.
- **Domain events**: bus interno `_domainEvents` con `raise()` y `pullDomainEvents()` cuando el agregado tiene eventos publicados; `raise(new XxxEvent(...))` se materializa automáticamente en transiciones de estado declaradas por `enums[].values[].transitions[]` (caso `Product.activate()` y `Product.discontinue()`).
- **Métodos de negocio** (`businessMethods`) derivados de `domainMethods[]` con cuatro modos de cuerpo:
  1. `softDelete()` determinístico: `this.deletedAt = Instant.now();`.
  2. Transición de estado (`Status.transitionTo(NEW)`) cuando el UC no tiene parámetros y el enum declara la transición.
  3. `addX(...)` que inserta en la colección hija usando el constructor de creación de la entidad.
  4. `removeX(id)` con `removeIf(x -> x.getId().equals(id))`.
  5. Update simple por *blind copy* cuando todos los params coinciden con propiedades del agregado.
  - Cualquier otro caso → cuerpo *scaffold* (`UnsupportedOperationException` no se emite aquí, pero sí los comentarios `// TODO: implement business logic — ver {bc}-flows.md` y `// Validate: <ruleIds>`).
- **Entidades hijas** (`entities[]`) en `composition`:
  - Generadas en `domain/entity/` con dos constructores (full + creation) excepto si son `immutable: true`, donde solo se emite el constructor full y los campos quedan `final`.
  - JPA entity con `@OneToMany(cascade = ALL, orphanRemoval = true)` cuando son mutables; con `cascade = { PERSIST }, orphanRemoval = false, @Immutable` cuando declaran `immutable: true` (caso `PriceHistory`).
- **JPA entity (raíz)** con Lombok completo, `@Entity`, `@Table(name = ...)`, `@Index` para `indexed: true`, `unique = true` para `unique: true`, `@SQLRestriction("deleted_at IS NULL")` para soft-delete, hereda `FullAuditableEntity` cuando `auditable` o `softDelete`.
- **Expansión de `Money`** en dos columnas (`*_amount` `BigDecimal precision=19, scale=4` + `*_currency` `String length=3`) y **expansión de VOs multi-propiedad en `List[T]`** a `@Embeddable` con `@ElementCollection` + `@CollectionTable` (caso `category_topics` ↔ `TopicsEmbeddable`).
- **Mappers inline** `toDomain` / `toJpa` en `RepositoryImpl`, con expansión inversa de `Money` y de embeddables, y publicación automática de `pullDomainEvents()` por `ApplicationEventPublisher` después del `save`.
- **Auto-inyección** de la query `softDelete(id)` en la `JpaRepository` cuando `softDelete: true`, vía `@Modifying` UPDATE sobre `deletedAt`.

### 1.b Veredicto

Para el **happy path "agregado con propiedades simples + VO mono-propiedad + Money + un enum + uso de `auditable`/`softDelete` + dos entidades hijas (una mutable, una inmutable) + transiciones de estado declaradas en el enum"** el generador produce código compilable y semánticamente correcto.

Sin embargo, hay un conjunto significativo de gaps que aparecen **en cuanto el diseño introduce reglas declaradas que el generador no traduce** (no son edge cases extremos: son patrones DDD/Spring habituales). Se listan a continuación, ordenados por severidad y por probabilidad de aparecer en cualquier diseño realista.

---

## 1.c Estado de implementación tras Tier 1 / Tier 2 / Tier 3

> **Resumen.** Los gaps de Tier 1 (corrección) y Tier 2 (motor declarativo de `domainRules`) están **resueltos y verificados con `gradle compileJava` BUILD SUCCESSFUL**. De Tier 3 se cubrieron los aditivos clave: `concurrencyControl: optimistic` (S2), `hidden: true` (S5), `emits` como lista (S22) y child entities `oneToOne` + `aggregation` (S6 parcial; `manyToMany` queda **vetado** por mala práctica DDD).
>
> Documentación de las nuevas características: [docs/aggregates-new-features.md](../docs/aggregates-new-features.md).

### Tier 1 — Corrección (✅ todos resueltos)

| ID | Resumen del fix |
|---|---|
| G1 | `delete` se renombra a `softDelete` en agregados con `softDelete: true` y se cablea al `@Modifying @Query` canónico en la `JpaRepository`. |
| G2 | `repository-generator.buildCountQuery` tiene whitelist estricta (`NonDeleted`/`Deleted`/`{Literal}`/`Non{Literal}`); falla explícitamente si no resuelve. |
| G3 | `validation-mapper.buildDomainChecks(prop)` emite `creationChecks` en aggregate root y child entities (BigDecimal-aware). |
| G4 | `ChildEntity.java.ejs` ya emite constructor de creación + `creationChecks` en entidades `immutable: true`. |
| G6 | Query `softDelete(id)` autogenera `@Modifying @Query("UPDATE ... SET deletedAt = :now WHERE id = :id")`. |
| S10 | `terminalState` se enforce vía `Enum.transitionTo()` + emisión en UCs scaffold de transición. |
| S14 | `PageRequest.of(_page != null ? _page : 0, _size != null ? _size : 20)` (NPE-safe). |
| (extra) | Importes duplicados eliminados en JpaRepository (G5). |

### Tier 2 — Motor declarativo de `domainRules` (✅ resuelto)

- Whitelist estricta de `domainRules[].type`: `uniqueness`, `statePrecondition`, `terminalState`, `sideEffect`, `deleteGuard`, `crossAggregateConstraint`. Validación de claves permitidas y de coupling de hints en `bc-yaml-reader.js`.
- Nuevo módulo [src/utils/domain-rule-mapper.js](../src/utils/domain-rule-mapper.js) con dispatcher `mapRule(rule, ctx)`:
  - **S8 / `crossAggregateConstraint`** → emite `findById(...).orElseThrow(...)` + guard de status en el handler, inyectando el repositorio destino y el enum `<Aggregate>Status`. Hints requeridos: `targetAggregate`, `field`, `expectedStatus`.
  - **S9 / `deleteGuard`** → emite `if (repo.<method>(id) > 0) throw <Error>;` en el handler, inyectando el repositorio destino. Hints requeridos: `targetAggregate`, `targetRepositoryMethod`.
  - Si los hints están incompletos, emite `// TODO domainRule(<id>, <type>): …` en lugar de inferir.
- **S13** — `application-generator` separa `validateRules` y `sideEffectRules` en el cuerpo de los UC scaffold; los side effects ya no se confunden con validaciones.
- **S20** — `AggregateRoot.java.ejs` y `ChildEntity.java.ejs` emiten bloque `equals/hashCode/toString` por id automáticamente.

### Tier 3 — Aditivos opt-in (✅ implementados)

| ID | Resumen | Detalle |
|---|---|---|
| S2 | `concurrencyControl: optimistic` a nivel de aggregate | Emite `@Version Long version` en JPA. Verificado en vivo. |
| S5 | `hidden: true` en propiedades | Sin getter en domain, `@JsonIgnore` en JPA, excluido de ResponseDto/Mapper. |
| S22 | `emits` como lista de eventos | Acepta string (compat) o `[EventA, EventB]`; valida referencias a `domainEvents.published` y unicidad en la lista. |
| S6 (parcial) | `cardinality: oneToOne` + `relationship: aggregation` | Cuatro capas branchadas: domain, JPA, mapper null-safe, scaffolds `addX/removeX`. Matriz de cascade documentada. **`manyToMany` vetado**. |

### Diferidos (no exigidos por el diseño actual)

| ID | Motivo |
|---|---|
| S1 | Ids no-UUID — no aparece en el catálogo. |
| S3 / S4 | Multitenancy / encriptación — fuera de alcance del Tier original. |
| S7 | `applyTo` en eventos consumidos — sin caso de uso real. |
| S15 | `findByIdOrThrow` helper — los handlers ya repiten el patrón sin ambigüedad. |
| G7 | Índices compuestos / unique parcial — requiere extensión de schema. |
| S11 | `unique` dentro de `List[T]` — requiere convención adicional. |
| S16 / S17 / S18 / S19 / S21 / S23 | Refinamientos de baja prioridad. |
| `manyToMany` (parte de S6) | 🚫 **Vetado por decisión del diseñador** — mala práctica DDD. |

---

## 2. Gaps de **corrección** (producen código inconsistente, redundante o incorrecto)

### G1 — Inconsistencia `delete` físico vs. `softDelete` en el `RepositoryImpl` (severidad alta)

**Síntoma observado.** Para `Category` (`softDelete: true`):

- El dominio expone únicamente `softDelete()` (set de `deletedAt`), no `delete()`.
- La `JpaRepository` autogenera la query `@Modifying UPDATE CategoryJpa SET deletedAt = CURRENT_TIMESTAMP ...` como `softDelete(id)`.
- La interfaz de dominio `CategoryRepository` declara `void delete(UUID id)` (porque el YAML lo lista en `repositories[].methods`).
- La implementación `CategoryRepositoryImpl.delete(UUID id)` ejecuta `jpaRepository.deleteById(id)` → **hard delete**.

Resultado: el método `softDelete` JPA generado **nunca se invoca** y `repository.delete(id)` rompe la invariante del agregado (borra físicamente y dispara `DELETE` SQL). El handler scaffold mitiga el problema en runtime porque queda como `UnsupportedOperationException`, pero **el contrato del puerto está mal cableado**.

**Causa raíz.** [`repository-generator.js`](../src/generators/repository-generator.js#L292) clasifica `delete(id)` como `skip` (delegado a `JpaRepository.deleteById`) sin importar si el agregado es `softDelete: true`. La auto-inyección de `softDelete(id)` queda huérfana.

**Propuesta de fix.**
- Cuando `aggregate.softDelete === true`:
  - El método `delete(UUID id)` declarado en YAML debe traducirse a `void softDelete(UUID id)` en la interfaz de dominio (alineado con el método del agregado), o
  - El cuerpo del impl debe llamar a `jpaRepository.softDelete(id)` en lugar de `deleteById(id)`.
- Idealmente eliminar `delete(id)` del puerto de dominio y exponer `save(aggregate)` como única vía (el handler hace `aggregate.softDelete(); repo.save(aggregate);`). El método `delete` solo debería existir como puerto cuando la regla es *hard delete* (caso `Product` con `PRD-RULE-006`).

---

### G2 — `countNonDeletedByCategoryId` genera JPQL inválido (severidad alta)

**Síntoma observado.** El método `countNonDeletedByCategoryId` declarado en `repositories[Product].methods` (`derivedFrom: CAT-RULE-003`) se traduce en `ProductJpaRepository.java` a:

```java
@Query("SELECT COUNT(p) FROM ProductJpa p WHERE p.status = 'NONDELETED' AND p.categoryId = :categoryId")
int countNonDeletedByCategoryId(@Param("categoryId") UUID categoryId);
```

`p.status = 'NONDELETED'` no compila contra el enum `ProductStatus` (cuyos valores son `DRAFT`, `ACTIVE`, `DISCONTINUED`). El generador interpreta el sufijo verbal `NonDeleted` como un literal de enum.

**Causa raíz.** [`buildCountQuery`](../src/generators/repository-generator.js#L210) en `repository-generator.js` aplica heurísticas por convención (`count<Adjective><Plural>By<Field>`) y, cuando no encuentra agregado plural en el nombre, asume que el adjetivo es un valor de enum. No reconoce el predicado semántico "non-deleted" (que en realidad equivale a `deletedAt IS NULL` cuando hay soft delete activo en otro agregado).

**Propuesta de fix.**
- Vocabulario reservado de cualificadores: `NonDeleted`, `Deleted`, `Active`, `Pending`, `Inactive`, `Archived`, … cada uno con una traducción JPQL definida.
- Para `NonDeleted` la condición correcta es:
  - Si el **agregado destino** (`Product` aquí) tiene `softDelete: true` → `a.deletedAt IS NULL`.
  - Si el agregado destino **no** tiene soft delete pero existe semántica equivalente vía `status` → no aplicar el filtro y emitir aviso.
  - Aquí (`Product` no es soft-delete) → la regla pertenece a `CAT-RULE-003` que debería contar **todos** los productos asociados a la categoría que aún están vivos: en este caso simplemente `COUNT(*) WHERE categoryId = :categoryId` y la regla del dominio define qué se considera "vivo".
- Mientras no exista un mapeo declarativo, el generador debe **detenerse y notificar** en lugar de inventar `'NONDELETED'`.

---

### G3 — `validations[]` declaradas en `properties[]` del agregado **no se enforce** en el dominio (severidad alta)

**Síntoma observado.** El YAML declara para `Category.name` y `Product.name`:

```yaml
validations:
  - minLength: 2
```

El constructor de creación de `Category` y `Product` acepta `null`, cadena vacía, o cadena de un solo carácter sin emitir ningún check. La invariante "name no puede ser vacío ni < 2 caracteres" solo existe **en la documentación** del YAML.

A esto se suma que `required: true` tampoco se verifica en el agregado: cualquier campo `required` puede llegar `null` por el constructor sin lanzar excepción.

**Causa raíz.** El aggregate generator solo invoca el bloque de validaciones para Value Objects (a través de `validation-mapper.js`). Los agregados copian valores directamente con `this.x = x;` sin pasar por un mecanismo equivalente.

**Propuesta de fix.**
- Reutilizar `validation-mapper.js` para emitir, dentro del **constructor de creación** y/o de los métodos `update`/`addX` del agregado, los mismos checks que ya se emiten para VOs (`Objects.requireNonNull`, `length() >= n`, `min`, `max`, `pattern`, `notEmpty`, `positive`, …).
- Importante: solo en métodos que **mutan** el campo. El constructor de reconstrucción (proveniente de la BD) debe permanecer permisivo o tendrá fallos al rehidratar registros legacy.

---

### G4 — Entidades hijas `immutable: true` quedan **sin factory de creación** (severidad alta)

**Síntoma observado.** `PriceHistory` (PRD-RULE-005: "se debe registrar una entrada en cada cambio de precio") se genera con un único constructor:

```java
public PriceHistory(UUID id, Money price, Instant changedAt) { … }
```

No hay constructor de creación (sin `id`, con `now()` para `changedAt`). El template [ChildEntity.java.ejs](../templates/domain/ChildEntity.java.ejs) emite `if (!immutable && creationParams.length > 0)` y excluye el creation constructor completo cuando `immutable: true`. Como consecuencia, **no existe forma legítima de instanciar un `PriceHistory` desde el dominio** (todo `id` y `changedAt` debería autogenerarse), y el aggregate root no tiene ningún método del estilo `recordPriceChange()` que sí existe semánticamente vía PRD-RULE-005.

**Causa raíz.**
1. La inmutabilidad de la entidad hija se confunde con "nunca se crea": en realidad `immutable` significa "no se actualiza ni borra **una vez creada**", pero la creación sigue siendo necesaria.
2. PRD-RULE-005 (`type: sideEffect`) es una regla declarada pero el generador no genera el side effect dentro de `Product.update(...)` ni una factory.

**Propuesta de fix.**
- Para entidades hijas `immutable: true`, emitir **igualmente** un constructor de creación con `final` en todos los campos y los `autoInits` (`UUID.randomUUID()`, `Instant.now()`).
- Para reglas `type: sideEffect` que mencionen una entidad hija `immutable`, generar dentro del método mutador correspondiente del agregado un fragmento `// TODO: side effect — ver {bc}-flows.md` y, opcionalmente, una llamada plantilla `this.priceHistories.add(new PriceHistory(this.price));`.

---

### G5 — Imports duplicados / redundantes en JPA repositories (severidad media)

**Síntoma observado.** En [`ProductJpaRepository.java`](../src/main/java/co/com/asuarez/catalog/infrastructure/persistence/repositories/ProductJpaRepository.java#L5-L7) aparecen:

```java
import java.util.UUID;
import java.util.UUID;
```

Aunque el código compila (Java tolera imports duplicados), evidencia un fallo en `collectJpaRepoImports`. Indica que el `Set` de imports se construye sin canonicalización en al menos una ruta.

---

### G6 — `@Modifying` no se emite en la query auto-inyectada `softDelete(id)` (severidad alta)

**Síntoma observado.** La query autogenerada en `CategoryJpaRepository.java`:

```java
@Query("UPDATE CategoryJpa a SET a.deletedAt = CURRENT_TIMESTAMP WHERE a.id = :id")
void softDelete(@Param("id") UUID id);
```

Le **falta** `@Modifying` (y, dependiendo de la versión de Spring Data, `@Transactional`). En Spring Data JPA, una query `UPDATE`/`DELETE` sin `@Modifying` lanza `InvalidDataAccessApiUsageException` en runtime.

**Causa raíz.** [`buildJpaRepoInterfaceContext`](../src/generators/repository-generator.js#L982) marca `modifying: true` en el descriptor pero la plantilla [JpaRepositoryInterface.java.ejs](../templates/infrastructure/JpaRepositoryInterface.java.ejs) no consume el flag (verificable porque la salida no contiene `@Modifying`).

**Propuesta de fix.** Anotar con `@Modifying` (e idealmente `@Transactional`) cualquier query `UPDATE`/`DELETE` en la JpaRepository.

---

### G7 — `@Index` se emite, pero el generador **no** crea índices compuestos ni respeta `unique` con `where` parcial (severidad media)

**Síntoma observado.** Funciona el caso simple (`indexed: true` → `@Index`). No están cubiertos:
- Índices compuestos (no hay propiedad YAML `indexes:` a nivel de agregado).
- Unique parcial (típico cuando combinas `unique: true` + `softDelete: true`: la unicidad debería ser sobre las filas con `deletedAt IS NULL`). Hoy el generador emite `unique = true` global, lo que impide reutilizar `name`/`slug` después de borrar lógicamente una categoría → choca con `CAT-RULE-001` ("name único regardless of status").

**Propuesta de fix.** Añadir al schema:

```yaml
indexes:
  - columns: [categoryId, status]
    unique: false
  - columns: [name]
    unique: true
    where: deletedAt IS NULL
```

…y mapear a `@Index(..., unique=true)` o, para *partial unique* (PostgreSQL), al script Flyway/Liquibase que ya emite el generador de base.

---

### G8 — `references` + `relationship: association` + `cardinality` se ignora en JPA (severidad media)

**Síntoma observado.** `Product.categoryId` declara:

```yaml
references: Category
relationship: association
cardinality: manyToOne
```

El generador emite simplemente `@Column(name = "category_id")`. Es coherente con la regla DDD "los agregados se referencian solo por id", pero entonces **`relationship` y `cardinality` son ruido**: el YAML declara información que el generador descarta.

**Propuesta de decisión.** Documentar oficialmente que ese trío es **solo trazabilidad** y no produce JPA `@ManyToOne`. Si en algún momento se decide soportar `@ManyToOne` (cuando dos aggregates viven en el mismo BC y se quiere foreign key física), debe ser un opt-in explícito (`fkConstraint: true` o similar). Actualmente el comportamiento es razonable pero **silencioso**, y un diseñador puede esperar comportamiento JPA convencional.

---

## 3. Gaps de **alcance** (escenarios habituales no soportados)

### S1 — Dominio sin ID generado: agregado con id natural (`String`, compuesto, ULID)

El generador asume `id: Uuid` con `defaultValue: generated`. No cubre:
- `id: String(...)` (e.g. ISBN, código corto humano).
- ID compuesto (`@IdClass` / `@EmbeddedId`).
- Identidad asignada por el cliente del UC en vez de `UUID.randomUUID()`.

Hoy intentar `id: String(20)` produciría tipos inconsistentes (el aggregate root tiene `private final UUID id` hardcoded en la plantilla — ver [AggregateRoot.java.ejs L26](../templates/domain/AggregateRoot.java.ejs#L26)).

### S2 — Versionado optimista (`@Version`)

Ningún campo de versión se inyecta nunca. Para CQRS con concurrencia real, `@Version Long version` debería generarse cuando el agregado declara `concurrencyControl: optimistic` (campo a añadir al schema).

### S3 — Multitenancy (`tenantId`)

No hay tratamiento de `tenantId` ni `@TenantId` (Hibernate 6) ni filtros de Hibernate (`@FilterDef`). Para SaaS multi-tenant esto es bloqueante.

### S4 — Encriptación at-rest / pseudonimización

Propiedades sensibles (`hidden: true`, `pii: true`, `encrypted: true`) son ignoradas. El YAML hoy solo soporta `hidden: true` y de hecho ni siquiera se procesa en el agregado (el campo se emite normal).

### S5 — `hidden: true` en aggregate root

Aunque AGENTS.md lo lista en la tabla de convenciones (campo excluido de DTOs sin getter), el generador del aggregate **siempre** emite getter. Hay que filtrar en el template de DTOs y, opcionalmente, marcar el campo como `@JsonIgnore` en el JPA. Hoy no se hace.

### S6 — Entidades hijas más allá de `oneToMany composition`

El generador acepta `relationship: composition` con `cardinality: oneToMany`. No cubre:
- `oneToOne composition` (típico para *embedded address*, *audit details*).
- `manyToMany` (ni siquiera dentro del mismo BC).
- `aggregation` (composición débil donde la hija tiene ciclo de vida propio pero el padre la referencia).

Cualquiera de esos tres aparece en diseños comunes (catálogo con tags, productos con variantes, etc.).

### S7 — Eventos consumidos no tocan el agregado

`domainEvents.consumed[]` no genera ningún punto de entrada en el agregado. Si una regla del tipo "cuando llega `OrderPlaced`, decrementar el stock" debería materializarse como un método `applyOrderPlaced(event)` en el agregado, hoy no ocurre. Solo se generan listeners en `infrastructure/adapters/`.

### S8 — Reglas `type: crossAggregateConstraint` quedan completamente como TODO

PRD-RULE-008 ("PRODUCT_CATEGORY_NOT_ACTIVE") implica una validación que **no puede vivir en el agregado** porque consulta otro agregado (`Category`). El generador lo lista como TODO en el comentario `// Validate: PRD-RULE-008` dentro de `Product.update`/`Product.create`, pero la implementación de Fase 3 tiene que conocer:
1. Qué repositorio inyectar al handler (`CategoryRepository`).
2. Qué método invocar (`findById` y comprobar `status == ACTIVE`).
3. Qué error lanzar (`PRODUCT_CATEGORY_NOT_ACTIVE`).

Sería razonable que el generador, cuando vea `type: crossAggregateConstraint`, inyecte automáticamente en el handler:

```java
Category cat = categoryRepository.findById(command.categoryId())
    .orElseThrow(() -> new CategoryNotFoundError(command.categoryId()));
if (cat.getStatus() != CategoryStatus.ACTIVE) {
    throw new ProductCategoryNotActiveError(command.categoryId());
}
```

(Hoy esto se mezcla parcialmente con `fkValidations`, pero `fkValidations` solo verifica existencia, no el estado).

### S9 — `domainRules.type: deleteGuard` sin enforcement

`CAT-RULE-003` (`deleteGuard`) implica que `Category.softDelete()` debe rechazar si `productRepository.countActiveByCategoryId(this.id) > 0`. Pero:
1. El agregado no puede inyectar repositorios → la verificación tiene que ir en el handler.
2. El handler `DeleteCategoryCommandHandler` se genera como scaffold puro, sin pista de qué método invocar.

Igual que S8, faltaría un **mapping declarativo** `deleteGuard → repository.method` para que el handler genere el `if (count > 0) throw …`.

### S10 — Reglas `type: terminalState` no se enforce automáticamente

`PRD-RULE-004` ("DISCONTINUED es terminal") podría volcarse al `transitionTo` del enum (si la transición no existe, lanzar `PRODUCT_ALREADY_DISCONTINUED`). Hoy el enum generado define solo las transiciones permitidas, pero **el código del aggregate `discontinue()` no rechaza** si ya está `DISCONTINUED` — aunque indirectamente lo hará el `transitionTo` si se implementa por blacklisting. Actualmente la lógica está como TODO scaffold.

### S11 — `unique` en propiedad multi-valor (`List[T]`)

`Category.topics` declara `unique: true` semántico (los topics dentro de la categoría deben ser únicos). El generador no enforce nada en el agregado ni en JPA (`@CollectionTable` sin unique constraint). Esto silenciosamente permite duplicados.

### S12 — Inicialización de listas en `update(...)` y `addX(...)`

`Product.update(...)` se genera como TODO scaffold cuando el método no encaja en el patrón "todos los params son props del agregado" (porque `categoryId` tiene tipo `UUID` y `price` tipo `Money`, mientras la implementación trivial sería `this.price = price; this.categoryId = categoryId; …`). Como el método **sí** cumple el `allMatch`, hoy el cuerpo se genera como blind-copy:

```java
public void update(String name, String description, Money price, UUID categoryId) {
    // TODO: implement business logic — ver catalog-flows.md
    // Validate: PRD-RULE-002, PRD-RULE-003, PRD-RULE-005, PRD-RULE-007, PRD-RULE-008
}
```

Verificado en [Product.java](../../../Users/antonio.suarez/Desktop/test-dsl/src/main/java/co/com/asuarez/catalog/domain/aggregate/Product.java): el método queda **sin cuerpo** porque `allMatch` falla (los nombres coinciden pero el método se enruta primero al *scaffold* por `implementation: scaffold`). Eso es razonable para Fase 3, pero la consecuencia es que **PRD-RULE-005 (sideEffect: registrar PriceHistory)** y **PRD-RULE-007 (sideEffect: re-derivar slug)** quedan completamente delegadas a Fase 3 sin ninguna pista en código. Ver G4 / S13 para la propuesta declarativa.

### S13 — Reglas `type: sideEffect` no producen comentarios trazables localizados

Las reglas `sideEffect` (PRD-RULE-005, PRD-RULE-007, CAT-RULE-004) sí aparecen en el comentario `// Validate: …` del método, pero ese comentario las trata como reglas a validar, no como side effects. Lo correcto sería emitir:

```java
// Side effects:
//   PRD-RULE-005: si price cambió → recordPriceChange(oldPrice)
//   PRD-RULE-007: si name cambió → this.slug = SlugUtil.derive(name)
```

El YAML tiene la información (`type: sideEffect`); el generador no la diferencia.

### S14 — Repositorio: paginación con cero datos

Métodos `Page<T>` que reciben `Integer page, Integer size` se traducen a `PageRequest.of(page, size)`. Si `page` o `size` son `null` (por ser `required: false` en la query), `PageRequest.of(null, null)` lanza NPE. No hay valores por defecto ni validación. Real para **todos** los métodos `query` paginados.

### S15 — Falta un `findByIdOrThrow`

Cada handler con `loadAggregate: true` repite manualmente `repository.findById(...).orElseThrow(...)`. Es razonable pero conviene generar un helper `findByIdOrThrow(UUID id)` en el repositorio cuando el YAML declara `notFoundError`. Sin esto, cada handler tiene que conocer la convención del error.

### S16 — `Projection` (read model) en `aggregates[]`

El generador soporta `aggregate.readModel: true` (filtra eventos publicados), pero el YAML actual declara `projections[]` aparte. La interacción entre ambos no está documentada y `readModel` **no se está usando** en `catalog.yaml`. Hay riesgo de duplicación si el diseñador intenta usar el flag.

### S17 — Embeddables comparten nombre entre BCs

`Topics` se expande a `TopicsEmbeddable`. Si dos BCs distintos definen un VO `Topics` con propiedades distintas, ambos JpaRepository generarían clases con el mismo nombre simple. La estructura de paquetes evita la colisión Java, pero el `@CollectionTable(name = "category_topics")` se forma con `${aggregate}_${field}` y queda OK. Sin embargo, no existe deduplicación cross-BC del embeddable: cada BC emitirá el suyo. Aceptable, pero ignora el caso "VO compartido en `shared/`".

### S18 — Constructor de creación con orden de parámetros frágil

El constructor privado de creación en `Category`:

```java
private Category(String name, List<Topics> topics, String slug, String description) { … }
```

`slug` aparece **entre `topics` y `description`** porque el orden lo dicta el orden de propiedades en el YAML. El factory `create(name, description, topics)` lo invoca pasando `null /* TODO: compute slug */` en posición 3. Si el diseñador reordena las propiedades en el YAML para ajustar columnas, el factory sigue funcionando porque `creationParams.map(name)` se usa para emparejar, **pero solo cuando el nombre coincide**. Para `slug` (no presente en el factory) la posición depende del orden YAML — cualquier reordenamiento puede romper el código en silencio porque el TODO siempre se inserta en posición.

Verificado: el generador hoy usa `creationParams.map((p) => factoryParamNames.has(p.name) ? p.name : 'null /* TODO */')`. Es **correcto** posicionalmente, pero acopla orden YAML ↔ orden de constructor. Documentar como contrato y considerar generar el factory con *named arguments* simulados via builder.

### S19 — `@Embeddable` para `Money` no se emite

A diferencia de `Topics` (multi-prop VO en `List[T]`), `Money` se expande siempre a `priceAmount`/`priceCurrency` aunque no esté en lista. Es coherente con la convención DDD, pero impide una estrategia alternativa (`@Embeddable Money` con `@AttributeOverrides`) que muchos equipos prefieren para reutilización. No hay flag para opt-in.

### S20 — Falta de `equals`/`hashCode`/`toString` en aggregate root y child entities

Mientras que VOs los incluyen (correctamente), las entidades de dominio y los aggregate roots no implementan `equals`/`hashCode` por id. Esto es defendible (DDD purist: identity ya es por referencia y por `getId()`), pero rompe colecciones (`HashSet<Product>`, `Map<Product, …>`) y el típico patrón `assertThat(product).isEqualTo(reloadedProduct)` en tests.

### S21 — `@JsonIgnore` / serialización al exterior

El aggregate root expone getters incluso para campos que el diseño marca como **internal** (`internal: true`, soportado en el reader). El generador emite el getter sin distinción. Si el handler retorna el aggregate (raro, pero posible cuando `returns: Aggregate`), se filtra `_domainEvents` o cualquier campo interno via Jackson.

### S22 — Domain event sobre cambio de relación

Cuando `Product.update` cambia `categoryId` (PRD-RULE-008), no hay evento `ProductCategoryChanged`. El YAML solo declara dos eventos. Si el diseñador lo añade, el generador debería poder routear el `raise(...)` automáticamente desde `update(...)` si el evento declara `triggersOn: UC-PRD-003 UpdateProduct`. Hoy `domainMethods[].emits` solo soporta **un** evento por método (string, no array).

### S23 — Reglas y eventos ligados a métodos compuestos

`addImage` no emite evento (`emits: null`), pero su declaración no tiene forma de expresar "emite evento solo si es la primera imagen". Reglas condicionales sobre eventos no son expresables.

---

## 4. Tabla de gaps priorizada

> Estado: ✅ resuelto · ⚠️ parcial · ❌ pendiente · 🚫 vetado por decisión de diseño · 🕒 diferido (sin caso de uso real).

| ID  | Gap | Severidad | Tier sugerido | Estado |
|-----|-----|-----------|---------------|--------|
| G1  | `delete` físico vs. `softDelete` mal cableado en RepositoryImpl | Alta | Tier 1 | ✅ |
| G2  | JPQL `'NONDELETED'` literal inválido | Alta | Tier 1 | ✅ |
| G3  | `validations[]` del agregado ignoradas en el dominio | Alta | Tier 1 | ✅ |
| G4  | Entidades hijas `immutable` sin factory de creación | Alta | Tier 1 | ✅ |
| G6  | `@Modifying` ausente en query `softDelete` | Alta | Tier 1 | ✅ |
| S10 | `terminalState` sin enforcement en `discontinue()` | Alta | Tier 1 | ✅ |
| S14 | `PageRequest.of(null, null)` en queries paginadas | Alta | Tier 1 | ✅ |
| G5  | Imports duplicados en JpaRepository | Media | Tier 2 | ✅ |
| G7  | Sin índices compuestos ni unique parcial con softDelete | Media | Tier 2 | 🕒 |
| S8  | `crossAggregateConstraint` sin generación en handler | Media | Tier 2 | ✅ |
| S9  | `deleteGuard` sin generación en handler | Media | Tier 2 | ✅ |
| S11 | `unique` en `List[T]` no enforced | Media | Tier 2 | 🕒 |
| S13 | `sideEffect` no se diferencia de validación en comentarios | Media | Tier 2 | ✅ |
| S20 | Falta `equals`/`hashCode` en agregados / entidades | Media | Tier 2 | ✅ |
| G8  | `relationship`/`cardinality` ignorados (documentar) | Baja | Tier 3 | ✅ (S6 implementa lifecycle real) |
| S1  | Solo soporta `id: Uuid generated` | Media | Tier 3 | 🕒 |
| S2  | Sin `@Version` (concurrencia optimista) | Media | Tier 3 | ✅ |
| S3  | Sin multitenancy | Media | Tier 3 | 🕒 |
| S4  | Sin encriptación / `pii: true` | Media | Tier 3 | 🕒 |
| S5  | `hidden: true` no respetado en getter | Baja | Tier 3 | ✅ |
| S6  | Sin `oneToOne`, `manyToMany`, `aggregation` | Media | Tier 3 | ⚠️ (`oneToOne` ✅, `aggregation` ✅, `manyToMany` 🚫) |
| S7  | Eventos consumidos no llegan al agregado | Media | Tier 3 | 🕒 |
| S15 | Falta `findByIdOrThrow` | Baja | Tier 3 | 🕒 |
| S16 | Documentar interacción `readModel` ↔ `projections[]` | Baja | Tier 3 | 🕒 |
| S17 | Embeddable cross-BC | Baja | Tier 3 | 🕒 |
| S18 | Orden frágil en factory de creación | Baja | Tier 3 | 🕒 |
| S19 | Sin `@Embeddable Money` opt-in | Baja | Tier 3 | 🕒 |
| S21 | Filtrado de campos `internal: true` en JSON | Baja | Tier 3 | 🕒 |
| S22 | Solo un `emits` por método | Media | Tier 3 | ✅ |
| S23 | Eventos condicionales no expresables | Baja | Tier 3 | 🕒 |

---

## 5. Conclusión

Tras los ciclos Tier 1, Tier 2 y Tier 3, el generador **cubre el escenario nominal completo de DDD** sobre el catálogo de prueba y traduce de forma ejecutable casi todas las reglas declaradas en `domainRules[]`:

- **Tier 1** cerró todos los gaps de corrección (G1–G6, S10, S14): el código generado es consistente con la semántica declarada (soft-delete real, queries JPQL válidas, validaciones declarativas, paginación NPE-safe, `@Modifying` en updates).
- **Tier 2** introdujo el motor declarativo `domainRules.type → emisión Java` documentado en la siguiente tabla, equivalente al que ya existe para `validations[]` en VOs:

| `domainRules.type` | Donde emite | Qué emite | Estado |
|--------------------|-------------|-----------|--------|
| `uniqueness` | RepositoryImpl + JPA `@Column(unique=true)` | Existente. | ✅ |
| `statePrecondition` | Aggregate method | Comentario trazable. | ✅ |
| `terminalState` | `Enum.transitionTo()` + UC scaffold | Guard automático. | ✅ |
| `sideEffect` | Aggregate method | Diferenciado de validation; split S13. | ✅ |
| `deleteGuard` | Handler + Repository method | Generado con hints `targetAggregate` + `targetRepositoryMethod`. | ✅ |
| `crossAggregateConstraint` | Handler | Generado con hints `targetAggregate` + `field` + `expectedStatus`. | ✅ |

- **Tier 3** añadió cuatro extensiones aditivas opt-in (`concurrencyControl: optimistic`, `hidden: true`, `emits` como lista, `cardinality: oneToOne` + `relationship: aggregation`) sin alterar diseños existentes. `manyToMany` queda vetado por decisión expresa.

El generador ha pasado del estado original ("scaffolding determinístico + happy path con `// Validate: …` como TODO") al estado objetivo ("scaffolding completo + invariantes ejecutables siempre que el YAML las declara con los hints requeridos"). Las extensiones futuras que aparecen en la tabla como 🕒 son refinamientos no exigidos por los diseños actuales y deberían introducirse solo cuando aparezca un caso de uso real, siguiendo el criterio de [AGENTS.md](../AGENTS.md): identificar el campo faltante con precisión, argumentar por qué resuelve una decisión ambigua, proponer la adición mínima al schema y notificar al usuario antes de proceder.
