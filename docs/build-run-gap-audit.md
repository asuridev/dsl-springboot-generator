# Auditoría de diseños/combinaciones que rompen el BUILD o el RUN del proyecto generado

Fecha: 2026-06-24
Alcance: **auditoría de solo lectura** (no se modificó el generador, templates ni `arch/`). El único artefacto producido es este informe.
JDK usado para compilar: `C:\java\jdk-17` (OpenJDK 17). La variable de entorno global `JAVA_HOME=C:\java` es inválida; se forzó `JAVA_HOME=C:\java\jdk-17` en cada invocación de Gradle.

## Objetivo

Detectar qué diseños y **combinaciones de features** producen código Java que **no compila** (error de build) o que **compila pero falla al arrancar/ejecutar** (error de run), y para cada gap indicar causa raíz, combinación YAML que lo dispara, y si un validador existente debería haberlo atrapado.

## Metodología

1. **Fase A — Build empírico:** se compiló (`./gradlew compileJava`) el Java generado de **todos** los escenarios happy-path vía `node test/runner.js --compile`.
2. **Fase B — Combinaciones apiladas:** se construyeron 2 fixtures sintéticos que **apilan** features que los escenarios prueban por separado, se generaron con `dsl-springboot build --strict` y se compilaron con Gradle.
3. **Fase C — Runtime/startup:** auditoría estática dirigida por categorías (cosas que `compileJava` no detecta: wiring de beans, mapeo JPA, manejo de excepciones, deserialización), inspeccionando generadores/templates y el código generado real.
4. **Fase D — Cruce con validadores** (`GEN-*`/`HTTP-*`/`INT-*`/estructural) para clasificar cada gap como ya cubierto, parcial o no cubierto.

---

## Resumen ejecutivo

La barrida de compilación sobre los 106 escenarios dio **101 pasan / 5 fallan** (`2843s`). Los 5 fallos son de **BUILD** (Java que no compila) y caen en **2 clases de bug del generador**. Las dos combinaciones densas que armé a mano (Fase B) sí compilan, pero la barrida exhaustiva encontró que ciertos patrones **rompen `compileJava`**.

Hallazgo transversal importante: **ninguno de los 5 escenarios que fallan hace opt-in al compile gate** (`scenario.json: compileGeneratedJava: true`), así que `npm test` (que solo hace diff de golden files) **no detecta** estas roturas. Son regresiones latentes — confirma el weak-point #1 de `mvp-robustez-generador.md`.

> **Estado (2026-06-24, post-auditoría):**
> - **BUILD:** B1 y B2 **corregidos** (fixes mínimos en `aggregate-generator.js` y `application-generator.js`), golden files regenerados y compile gate activado en los 5 escenarios.
> - **Suite final: 107/107** (106 originales + escenario nuevo `command-money-body` de R3), 0 regresiones.
> - **RUN:** **R1 corregido** (`@ExceptionHandler(OptimisticLockingFailureException)`→409, gateado). **R3 corregido** (Money canónico se interpone como `MoneyRequest` DTO; escenario nuevo `command-money-body`). **R2 verificado como NO-issue** en Hibernate 6.6 (un `@DataJpaTest` que persiste un aggregate con hijos pasa — Hibernate incluye la FK en el INSERT; sin cambio de código). **R4 ya estaba cubierto** por `validateBlockingUseCaseFallbacks` (`bc-yaml-reader.js:2434`), que falla el build ante `implementation: full` + `returns`; el `return null` es código muerto.

### Gaps de BUILD (compila ⇒ falla)

| # | Gap | Severidad | Combinación YAML que lo dispara | Escenarios | Validador |
|---|-----|-----------|---------------------------------|-----------|-----------|
| B1 | `List[DateTime]` como parámetro de método de dominio → `List<Instant>` sin `import java.time.Instant` → `cannot find symbol` | **Alta** | método de dominio (o derivado de evento) con `List[DateTime]` (o `List[<tipo que requiere import>]`) | `event-consumed-list-standard`, `event-kafka-consumed-list-standard` | No existe |
| B2 | UC `command` con `trigger.kind: event` y **sin `input[]`** → `*Command` record vacío, pero el listener de saga/evento lo construye con los campos del payload del evento → constructor no aplica | **Alta** | command event-triggered sin `input[]` + `domainEvents.consumed[].payload[]` con campos | `saga-basic`, `saga-compensation`, `saga-kafka` | No existe |

### Gaps de RUN (compila pero falla al arrancar/ejecutar)

`compileJava` no los detecta; es la razón por la que el pedido incluía "o realizar el run". Cuatro encontrados; estado tras la implementación de esta sesión:

| # | Gap | Severidad | Combinación YAML que lo dispara | Estado |
|---|-----|-----------|---------------------------------|--------|
| R1 | Conflicto de bloqueo optimista devolvía **500** en vez de **409** | Media | `aggregates[].concurrencyControl: optimistic` | **Corregido** (handler 409 gateado) |
| R2 | `@OneToMany` unidireccional + `@JoinColumn(nullable=false)` → posible violación NOT NULL al insertar hijos | Media (a verificar) | child entity `relationship: composition`, `cardinality: oneToMany` | **No-issue** en Hibernate 6.6 (test de persistencia pasa) |
| R3 | Value Object de dominio (p.ej. `Money`) usado directo como campo `@RequestBody` | Baja-Media | input `source: body` con `type:` = un VO de dominio | **Corregido** (interposición `MoneyRequest`) |
| R4 | Handler con `implementation: full` + `returns` emitía `return null` | Baja | UC trivial con `returns` declarado | **Ya cubierto** (fail-fast del reader) |

Varias categorías de riesgo **están correctamente cubiertas** (se verificaron y NO son gaps): wiring de beans, inyección cross-aggregate, identidad temprana JPA, soft-delete, gating de cache provider, e `INT-025`. Ver Sección C.

---

## Sección A — Auditoría de BUILD (compilación)

Comando: `JAVA_HOME=C:\java\jdk-17 node test/runner.js --compile`

Resultado: **101/106 pasan, 5 fallan** (2843s). Los 5 fallos son de compilación:

```
Failed: event-consumed-list-standard, event-kafka-consumed-list-standard,
        saga-basic, saga-compensation, saga-kafka
```

Ninguno de los 5 hace opt-in al compile gate, por lo que `npm test` no los detecta hoy.

### B1 — `List[DateTime]` sin `import java.time.Instant` (alta)

- **Disparador:** un método de dominio con un parámetro `List[DateTime]` (o cualquier `List[<tipo que requiere import>]`). En estos escenarios el parámetro viene del payload de un evento consumido/publicado con un campo `type: List[DateTime]`.
- **Evidencia:** `Notification.java:35` → `public void notify(UUID shipmentId, List<UUID> productIds, List<Instant> checkpointTimes)` con imports solo `java.util.List` y `java.util.UUID`. **Falta `import java.time.Instant`** → `error: cannot find symbol`. Mismo patrón en `warehouse/Shipment.java:48` (`dispatch(List<UUID>, List<Instant>)`).
- **Por qué `List[Uuid]` no falla pero `List[DateTime]` sí:** `UUID` ya se importa porque aparece como tipo de campo/param suelto; `Instant` aparece **solo** dentro del `List[...]`, y el colector de imports del aggregate-generator no desciende al tipo elemento de la lista.
- **Causa raíz:** `src/generators/aggregate-generator.js` (resolución de imports de parámetros de métodos): mapea `DateTime`→`Instant` para el tipo pero no agrega el import cuando el tipo está anidado en `List[...]`.

### B2 — command event-triggered sin `input[]` vs. listener que pasa el payload (alta)

- **Disparador:** un UC `type: command` con `trigger.kind: event` que **no declara `input[]`**, mientras el `domainEvents.consumed[].payload[]` correspondiente sí tiene campos.
- **Evidencia:** `ReserveStockCommand` se genera como `public record ReserveStockCommand() implements Command {}` (0 componentes, porque el UC `reserve-stock` no tiene `input[]`). Pero `OrderPlacedRabbitListener.java:67` hace `new ReserveStockCommand(orderId, customerId)` mapeando los 2 campos del payload `OrderPlaced` → `error: constructor ReserveStockCommand cannot be applied to given types`. Igual con `ReleaseStockCommand`, `ProcessPaymentCommand` en `saga-compensation`/`saga-kafka`.
- **Causa raíz:** inconsistencia entre dos generadores. El **command-generator** deriva los campos del command del `input[]` del UC (vacío aquí), mientras el **saga/event-listener generator** asume que el constructor del command refleja el payload del evento consumido. Es la misma clase de invariante cruzado que `[[generator-event-attribution-invariant]]`, pero entre command-shape y listener.
- **Matiz diseño vs. bug:** se puede argumentar que el UC debería declarar `input[]` espejando el payload (omisión de diseño). Pero el generador hoy produce Java que no compila **en silencio**; la corrección mínima determinista es alguna de: (a) que el command-generator derive los campos del payload del evento consumido cuando el UC es event-triggered, (b) que el listener llame al constructor real del command, o (c) un validador que rechace esta divergencia.

### Notas
- `cs-http-full`, reportado en `mvp-robustez-generador.md` con drift de golden files, **hoy pasa diff y compila** (65.7s). El drift fue corregido desde aquel informe.
- Warning no bloqueante: `CacheConfig.java` "uses or overrides a deprecated API" (API de cache de Spring deprecada) cuando hay `cacheProvider`. Cosmético; conviene migrar el template en una limpieza futura.

**Conclusión A:** hay 2 clases de diseño que rompen el build (B1, B2), latentes porque sus escenarios no compilan en CI. El compile gate (`--compile`, ya implementado en `test/utils/scenario-runner.js`) es la red de seguridad correcta; hoy solo ~23/74 happy-path hacen opt-in. Recomendación (fuera de alcance de esta auditoría): activar el opt-in en todos (o correr `--compile` en CI), lo que habría atrapado B1 y B2.

---

## Sección B — Auditoría de COMBINACIONES apiladas

Los 106 escenarios prueban features **en aislamiento**. Se construyeron 2 fixtures que apilan features en un mismo aggregate/BC para buscar bugs de interacción. Fixtures en el scratchpad (`combo1/`, `combo2/`).

### Combo 1 — dominio denso
`auditable` + `concurrencyControl: optimistic` + `softDelete` + `Money` (en aggregate **y** en child entity) + child `composition oneToMany` + enum de ciclo de vida con `terminalState` + identidad temprana + **domain event con payload que incluye un `Money` y un enum**.

- Validación `--strict`: **OK** (sin diagnósticos).
- `./gradlew compileJava`: **BUILD SUCCESSFUL** (34s).
- Observaciones (correctas): `Money` expande a `*_amount`/`*_currency` (BigDecimal+String) en JPA, mapper y event DTO; `@Version`, `@SQLRestriction("deleted_at IS NULL")`, base `FullAuditableEntity` e identidad asignada (sin `@GeneratedValue`) conviven sin romper. El event record `OrderPlacedEvent` lleva `Money totalAmount` y `OrderStatus status` sin problema.
- Gaps de interacción detectados: **R2** (el `@OneToMany` del child) y **R3** (`Money` como body input en `CreateOrderCommand`). Ver Sección C.

### Combo 2 — stack de aplicación
Command idempotente (`idempotency.storage: cache`) + query `cacheable` (ambos sobre Redis) + `Range[Decimal]` + `SearchText` + paginación, en un solo BC.

- Validación `--strict`: **OK**.
- `./gradlew compileJava`: **BUILD SUCCESSFUL** (37s).
- Observaciones (correctas): idempotencia y cacheable coexisten sobre el mismo provider Redis sin colisión; `ProductSpecs` genera `byPriceRange(Range<BigDecimal>)` y `bySearchText(String)` juntos; `@Cacheable(cacheNames="getProductById", key="#query.productId")` correcto.

**Conclusión B:** ninguna de las dos combinaciones densas que armé rompe el build, así que el generador maneja bien el apilamiento de dominio/aplicación. Pero la Fase A muestra que el apilamiento de **integración/eventos** sí rompe: Combo 3 (saga + proyección `versionGuarded` + outbox + internal-api + ACL `oauth2-cc`) se dejó fuera por costo de autoría, y la Fase A confirmó que justamente los escenarios de esa familia (`saga-*` y `event-consumed-list-*`) **fallan al compilar** (gaps B1/B2). Es decir: el riesgo de combinación real está en la capa de integración/mensajería, no en la de dominio/HTTP.

---

## Sección C — Auditoría de RUN (startup/runtime)

`compileJava` no detecta estos. Clasificación por categoría: **gap real** vs **cubierto/correcto**.

### Gaps reales

#### R1 — Bloqueo optimista no se mapea a 409 (severidad media)
- **Disparador:** `aggregates[].concurrencyControl: optimistic`.
- **Evidencia:** `templates/shared/handlerException/HandlerExceptions.java.ejs` mapea `DataIntegrityViolationException`→409, `ConflictException`→409, `InvalidStateTransitionException`→409, validación→422, etc., pero **no tiene `@ExceptionHandler` para `OptimisticLockingFailureException` / `ObjectOptimisticLockingFailureException`**.
- **Efecto en run:** bajo contención concurrente, Hibernate lanza `ObjectOptimisticLockingFailureException` (por el `@Version` que sí se genera en `OrderJpa`), que cae al handler genérico → **HTTP 500** en lugar de **409 Conflict**. El diseño declaró `optimistic` justamente para manejar concurrencia, pero el cliente no recibe una señal accionable.
- **Cómo confirmarlo:** dos updates concurrentes del mismo aggregate con `@Version`; observar 500.
- **✅ Resuelto:** se agregó `@ExceptionHandler(OptimisticLockingFailureException.class)` → 409 en `HandlerExceptions.java.ejs`, gateado por la flag `optimisticLockingEnabled` (computada en `base-project-generator.js` a partir de `concurrencyControl: optimistic`) para no tocar el handler de proyectos sin bloqueo optimista. Golden actualizado: `domain-aggregate-optimistic-lock`.

#### R2 — `@OneToMany` unidireccional con `@JoinColumn(nullable=false)` (severidad media — verificar)
- **Disparador:** child entity `relationship: composition`, `cardinality: oneToMany`.
- **Evidencia:** `OrderJpa.orderLines` se genera como `@OneToMany(cascade=ALL, orphanRemoval=true, fetch=LAZY)` + `@JoinColumn(name="order_id", nullable=false)` **sin `mappedBy`** (unidireccional). El hijo `OrderLineJpa` no tiene la columna `order_id` como atributo propio. Ver `templates/infrastructure/JpaEntity.java.ejs` (líneas ~51-64).
- **Efecto en run (potencial):** patrón clásico de Hibernate para `@OneToMany` unidireccional con `@JoinColumn`: insertar el hijo con FK nula y luego un `UPDATE` para setear la FK. Con `nullable=false` el `INSERT` inicial puede violar el NOT NULL → `PropertyValueException`/violación de constraint al persistir un aggregate con hijos. El comportamiento exacto depende de la versión de Hibernate (Spring Boot 3.4.5 = Hibernate 6.6), por eso se marca **a verificar**, no como bug confirmado.
- **Cómo confirmarlo:** test de persistencia (`@DataJpaTest` o integración con Postgres/H2) que guarde un `Order` con ≥1 `OrderLine`.
- **✅ Verificado como NO-issue:** se generó el proyecto `domain-aggregate-child-entities` y se corrió un `@DataJpaTest` (H2, `ddl-auto=create-drop`) que persiste un `Order` con una `OrderLine` y la recarga → **pasa**. Hibernate 6.6 incluye la FK `order_id` en el `INSERT` del hijo (no hace insert-then-update), así que la violación NOT NULL **no ocurre**. PostgreSQL se comporta igual (ambos chequean NOT NULL al insertar). Sin cambio de código.

#### R3 — Value Object de dominio como campo `@RequestBody` (severidad baja-media)
- **Disparador:** un `useCases[].input` con `source: body` cuyo `type` es un VO de dominio (en Combo 1: `totalAmount: Money`).
- **Evidencia:** `CreateOrderCommand` es un `record` con `@NotNull Money totalAmount`, y el controller hace `@RequestBody CreateOrderCommand command`. `Money` (`domain/valueobject/Money.java`) es `final class` con **un solo constructor `Money(BigDecimal, String)`, sin `@JsonCreator` ni constructor vacío**.
- **Efecto en run:** la deserialización JSON→`Money` **depende** de que el plugin de Spring Boot compile con `-parameters` (lo hace por defecto) y del `ParameterNamesModule` (auto-registrado) para detectar el creador implícito por nombres `amount`/`currency`. Funciona en el happy path, pero: (a) **acopla el contrato de wire al VO de dominio**; (b) las validaciones estrictas del constructor (`setScale(4, UNNECESSARY)`, `currency.length()>3`) se ejecutan **durante** la deserialización → un body mal formado produce un **400 genérico** (`HttpMessageNotReadableException`) en vez de un error de validación estructurado.
- **Comparación:** para un `Uuid` body el generador usa `String` en el command (tipo de wire), pero para `Money` usa el VO de dominio directo — inconsistencia de criterio.
- **Causa raíz precisa:** la maquinaria `VoRequest` DTO **ya existía** (`buildCommandFields` emite `{Vo}Request` para VO multi-propiedad declarado en `valueObjects[]`), pero el `Money` **canónico** (usado por nombre sin declararlo) no se resolvía como VO → caía a bindear el `Money` de dominio.
- **✅ Resuelto:** nuevo helper `src/utils/canonical-vo.js` (`resolveVoDefinition`) que resuelve VOs declarados **y** canónicos (Money). `buildCommandFields` y `generateVoRequestRecord` lo usan, de modo que un `type: Money, source: body` ahora se interpone como `MoneyRequest` (`record MoneyRequest(BigDecimal amount, String currency)`, Jackson-native) con `@Valid`, sin acoplar el dominio al wire. Escenario nuevo `command-money-body` (con compile gate) bloquea la regresión. Sin churn en goldens existentes (ningún escenario commiteado usaba Money canónico como body input).
- **✅ Follow-up (regresión detectada en proyecto real `test-dsl`):** el fix inicial solo cubría el **campo** del command; faltaba la **conversión en el cuerpo del handler** `implementation: full` (la auditoría solo probó handlers `scaffold`, que lanzan un TODO sin llamar al dominio). Un handler `full` pasaba `command.price()` (`MoneyRequest`) a un parámetro de dominio `Money` → `incompatible types`. Corregido: los 4 sitios de conversión en `buildCommandHandlerBody` usan ahora `resolveMultiPropertyVo` (declarado **+** canónico) → emiten `new Money(command.price().amount(), command.price().currency())`, **gateado por `!isEventTriggered`** (los commands event-triggered conservan el `Money` de dominio en su campo y no deben re-ensamblarse). Caso `UpdateProductPrice` (`implementation: full` + Money body) añadido a `command-money-body`. Suite **107/107**.

#### R4 — `return null` en `implementation: full` + `returns` (severidad baja)
- **Disparador:** un UC trivial (`implementation: full`) que además declara `returns`.
- **Evidencia:** `src/generators/application-generator.js` (~línea 2290) agrega `// TODO ... return null;` cuando el cuerpo autogenerado no produce un return. Coincide con el weak-point #4 de `mvp-robustez-generador.md`.
- **Efecto en run:** compila, pero el handler devuelve `null` → el controller responde body `null` o NPE aguas abajo si se desreferencia.
- **✅ Ya cubierto (no requiere fix):** `validateBlockingUseCaseFallbacks` (`bc-yaml-reader.js:2434`) hace `fail()` ante cualquier command `implementation: full` + `returns` (salvo bulk/jobTracking, que retornan `BulkResult`/`JobReference` de forma determinista). El `return null` de `application-generator.js:2293` es **inalcanzable** en ese caso (el `fail()` del reader es duro, no diagnóstico). El escenario `command-full-return-unmapped` (`expectFailure`) lo prueba. Se deja el código tal cual para no tocar la ruta de bulk/jobTracking.

### Categorías verificadas que NO son gaps (cubiertas)

| Categoría | Estado | Evidencia |
|-----------|--------|-----------|
| Wiring de beans de handlers | Correcto | `@ApplicationComponent` es marker sin `@Component`, **pero** `UseCaseConfig.java.ejs` agrega `@ComponentScan(includeFilters=@Filter(ApplicationComponent.class), …)`. Los handlers se registran. |
| Inyección cross-aggregate para guards | Correcto | `application-generator.js` calcula `extraRepos` (deleteGuard/crossAggregateConstraint/statePrecondition) y los inyecta en el constructor del handler (escenario `handler-statePrecondition-repo`). |
| Identidad temprana JPA | Correcto | `OrderJpa.id` = `@Id @Column(updatable=false)` UUID **asignado**, sin `@GeneratedValue`. |
| Soft delete | Correcto | `@SQLRestriction("deleted_at IS NULL")` + columna `deleted_at`. |
| Gating de cache provider | Correcto | `build.js` exige `cacheProvider` cuando hay `idempotency`/`cacheable`; Combo 2 lo confirma. |
| `source: authContext` en payload de evento | Cubierto | `INT-025` lo rechaza (evento debe ser security-agnóstico). |
| Violación de unicidad (carrera) | Correcto | `DataIntegrityViolationException`→409 en el handler global. |
| Mapper JPA↔dominio (Money, version, deletedAt) | Correcto | `OrderJpaMapper` expande Money en ambos sentidos, `@Component`. |

---

## Sección D — Cruce con validadores existentes

Ninguno de B1, B2, R1–R4 tiene validador hoy.

| # | ¿Por qué no se atrapa? | Corrección natural |
|---|------------------------|--------------------|
| B1 | El validador de tipos (`GEN-001`) confirma que `List[DateTime]` **resuelve**, pero no valida imports; el bug está en el colector de imports del generador, no en el YAML. | Fix en `aggregate-generator.js` (descender al tipo elemento de `List[...]` al recolectar imports). El compile gate lo atraparía como regresión. |
| B2 | El YAML es individualmente válido; la rotura emerge del cruce command-shape ↔ listener, que ningún validador examina. | Fix de generador (derivar campos del command desde el payload, o llamar al constructor real) **o** nuevo código de validación (command event-triggered cuyo payload consumido no se refleja en `input[]`/command). |
| R1 | Vive en template (manejo de excepciones), no en YAML. | Agregar `@ExceptionHandler(OptimisticLockingFailureException)` → 409. |
| R2 | Vive en template (mapeo JPA). | Mapeo bidireccional / FK insertable. |
| R3 | **Sí** detectable desde YAML: input `source: body` con `type` ∈ valueObjects/Money. | Nuevo código (p.ej. `GEN-WARN-002`/`HTTP-WARN-001`) **o** interponer request DTO para body VO. |
| R4 | Es clasificación de TODOs, no validador. | Endurecer `--strict` (roadmap Fase 2). |

Insumo para una futura fase de **hardening** (no incluida en esta auditoría): 2 fixes de generador de alta prioridad (B1, B2 — rompen build), 2 ajustes de template (R1, R2), 1 validador/refactor de DTO (R3), 1 endurecimiento de `--strict` (R4). Atajo de mayor ROI: **activar el compile gate en todos los escenarios happy-path** — habría atrapado B1 y B2 automáticamente.

---

## Apéndice — Reproducción

```bash
# Fase A: compilar todos los happy-path  (resultado: 101/106; fallan event-consumed-list-*, saga-*)
JAVA_HOME=C:\java\jdk-17 node test/runner.js --compile
# Reproducir B1 y B2 con detalle:
node test/runner.js --scenario event-consumed-list-standard --compile --verbose   # B1: falta import Instant
node test/runner.js --scenario saga-basic --compile --verbose                      # B2: constructor command no aplica

# Fase B: combos (fixtures en el scratchpad)
cd <scratchpad>/combo1 && node <gen>/bin/dsl-springboot.js build --strict && JAVA_HOME=C:\java\jdk-17 ./gradlew.bat compileJava --no-daemon
cd <scratchpad>/combo2 && node <gen>/bin/dsl-springboot.js build --strict && JAVA_HOME=C:\java\jdk-17 ./gradlew.bat compileJava --no-daemon

# Fase C: evidencias estáticas
#   R1: templates/shared/handlerException/HandlerExceptions.java.ejs  (sin OptimisticLock)
#   R2: templates/infrastructure/JpaEntity.java.ejs  (@OneToMany + @JoinColumn(nullable=false))
#   R3: <combo1>/src/.../application/commands/CreateOrderCommand.java  +  domain/valueobject/Money.java
#   R4: src/generators/application-generator.js (~línea 2290)
#   wiring: templates/shared/configurations/useCaseConfig/UseCaseConfig.java.ejs
```
