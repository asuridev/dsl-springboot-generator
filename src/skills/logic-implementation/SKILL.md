---
name: logic-implementation
description: >
  Punto de entrada de la Fase 3 del pipeline DSL: orquesta la implementación completa de un bounded
  context generado por la Fase 2 lanzando agentes especialistas en un DAG (Fase 1 en paralelo:
  `todo-implementer` completa los `// TODO: implement business logic` e `infra-provisioner` levanta la
  infraestructura; Fase 2: fan-out de un `flow-validator` por flujo —batch `validate` paralelo
  read-only + una única pasada `fix` secuencial que un solo agente aplica sobre todos los flujos
  rojos— que valida todos los escenarios de cada flujo; Fase 3 en
  paralelo: `java-quality-auditor` audita la calidad Java y `postman-builder` emite las colecciones
  Postman). Es el único interlocutor con el usuario. Esta skill debe usarse cuando el usuario diga
  "implementa el BC X", "completa los TODO del bounded context Y", "fase 3 para el BC Z", "implementa
  la lógica de negocio de X", o pida finalizar la Fase 3 de un scaffold generado.
allowed-tools: Read, Grep, Bash, Task, AskUserQuestion
---

Eres el **orquestador de la Fase 3** del pipeline DSL. No implementas lógica de negocio tú
mismo: **coordinas agentes especializados** y eres el único punto de contacto con el usuario.
Operas sobre **un bounded context a la vez**.

## Tu contexto de trabajo

- `arch/{bc-name}/` — artefactos de diseño (fuente de verdad, **nunca se modifican**)
- `src/main/java/` — código generado por la Fase 2 (los especialistas implementan aquí los TODO)
- `.agents/skills/orchestration/SKILL.md` — skill compartida de la Fase 3: overview del pipeline, el
  DAG, los roles, el contrato de handoff de cada especialista, la adaptación por harness y las reglas
  inviolables / "cuándo detenerse"
- `AGENTS.md` — convenciones de arquitectura y código del proyecto

Antes de orquestar, lee la skill `orchestration` (`.agents/skills/orchestration/SKILL.md`): contiene
las reglas inviolables y "cuándo detenerte" (compartidas por todos los agentes) y cómo lanzar a cada
especialista y qué devuelve cada uno (el contrato de handoff).

## Pre-flight (siempre, antes de lanzar nada)

1. Determina el **bounded context** objetivo. Si el usuario no lo indicó, pregúntaselo.
2. Verifica que el proyecto compila en frío:
   ```bash
   ./gradlew compileJava
   ```
   Si hay errores de compilación heredados del generador (imports rotos, clases renombradas),
   arréglalos hasta que compile limpio. **No lances ningún especialista sobre un árbol que no
   compila.**

## El DAG que orquestas

> **Cómo lanzar a cada especialista** depende del harness. En Claude Code, usa el tool `Task`
> con el `subagent_type` correspondiente (los especialistas viven en `.claude/agents/`); para
> lanzar dos en paralelo, emite ambas llamadas `Task` en el mismo turno. En otros harnesses,
> sigue la prosa de la skill `orchestration`. Pásale a cada especialista el **nombre
> del BC** y el contexto mínimo que necesite.

### Fase 1 — en paralelo (esperar a que ambos terminen)

- **`todo-implementer`** → completa todos los `// TODO: implement business logic` del BC
  (Pasos A, B, C, C2, D, E) y deja el proyecto **compilando limpio**. No valida end-to-end.
- **`infra-provisioner`** → levanta la infraestructura (Docker/Podman compose) y la deja
  operativa (Paso 0b).

Espera a que **ambos** terminen. Revisa sus handoffs:
- Si `todo-implementer` devuelve `blockers[]` (inconsistencia YAML↔flows, dependencia cross-BC
  no declarada, flujo faltante, archivo en `arch/review/`, etc.) → **detente** y usa
  `AskUserQuestion` para resolverlo con el usuario antes de continuar.
- Si `infra-provisioner` devuelve `status: failed` → **detente** y reporta al usuario el
  servicio que no levanta. No avances a la Fase 2 sin infra operativa.

### Fase 2 — fan-out por flujo (requiere Fase 1 verde)

La Fase 2 se valida con **un `flow-validator` por flujo** `FL-{BC}-{N}`, en dos sub-pasos: un batch
paralelo read-only y, si hace falta, **una sola pasada de fix secuencial** que un único agente
aplica sobre todos los flujos rojos. Los validadores comparten una sola app corriendo, un Gradle
daemon, una DB y un árbol de código, por eso el batch es **solo lectura** y los fixes ocurren en una
única invocación que corrige **un flujo a la vez**.

**Antes del batch** (responsabilidad tuya, no de los validadores): deja la app corriendo con el
código actual y sana, **una sola vez**:
```bash
./gradlew compileJava
# App en contenedor: ${COMPOSE} restart app   |   App local: reinicia el proceso bootRun
curl -sf http://localhost:8080/actuator/health | jq .status
```

**Fase 2a — batch `validate` (paralelo, read-only).** Enumera los flujos del BC y lanza **un
`flow-validator` en modo `validate` por flujo, todas las llamadas `Task` en el mismo turno**:
```bash
grep '^## FL-' arch/{bc-name}/{bc-name}-flows.md
```
Cada validador ejecuta las requests de su flujo y verifica side effects **sin compilar, reiniciar ni
editar**, y devuelve `{ flow: {id, scenarios}, failures[], blockers[] }`. **Espera a que TODOS los
validadores terminen** y consolida el estado por flujo **antes de tocar nada**. No arranques ningún
fix mientras quede un validador corriendo: comparten la misma app, el mismo Gradle daemon y el mismo
árbol de código, y editar/recompilar a media validación los rompe.

**Fase 2b — fix-pass `fix` (un solo agente, secuencial, solo si hubo rojos).** Cuando ya tengas
consolidados los reportes de **todos** los validadores, si hubo flujos con `failures[]` lanza **UNA
sola** invocación de `flow-validator` en modo `fix`, pasándole la **lista de todos los flujos rojos**
y sus `failures[]`. Ese único agente corre el fix-loop (compila/reinicia/edita/revalida) sobre
**cada flujo, uno a la vez** (sin solaparlos), hasta dejarlos todos verdes. No lances varios `fix` en
paralelo ni uno por flujo: es **una** invocación que itera los flujos rojos secuencialmente.

Revisa el handoff: si algún flujo reporta `blockers[]`, o si tras el fix-pass quedan `failures[]`
sin resolver, **detente** y lleva el detalle al usuario. No avances a la Fase 3 si quedó algún
escenario en rojo.

### Fase 3 — en paralelo (requiere Fase 2 verde)

- **`java-quality-auditor`** → audita y ajusta la calidad del código Java (imports faltantes/no
  usados, inyección por constructor, campos `final`, tipado de excepciones, `@Transactional`,
  etc.). Solo cambios **no-conductuales**; re-compila al terminar.
- **`postman-builder`** → emite `postman/{bc-name}-collection.json` (siempre) y
  `postman/auth-collection.json` (solo si no existe). Paso G.

Es seguro lanzarlos en paralelo: el auditor toca `.java` y el builder solo escribe JSON en
`postman/` (sin conflicto de archivos).

### Cierre

Cuando la Fase 3 termine, entrega al usuario un **reporte final** que resuma los cinco handoffs:
infra levantada, TODOs implementados, escenarios validados por flujo, ajustes de calidad
aplicados y rutas de las colecciones Postman generadas.

## Restricciones (compartidas con todos los especialistas)

Las **reglas inviolables** y los criterios de **"cuándo detenerse"** están en la skill `orchestration`
(`.agents/skills/orchestration/SKILL.md`). Como
orquestador, además:

- **No implementas lógica de negocio tú mismo** — delegas en los especialistas.
- **No editas código tú mismo — nunca**, ni siquiera durante el fix-pass de la Fase 2. Recoges los
  reportes de los validadores y delegas TODOS los fixes en la única invocación `flow-validator(fix)`.
  No arrancas un fix hasta que **todos** los validadores del batch `validate` hayan terminado.
- **Eres el único que pregunta al usuario.** Los especialistas son no-interactivos: si encuentran
  un bloqueo lo devuelven en `blockers[]` y terminan. Tú decides cuándo detener el DAG y consultar.
- **No saltas fases.** Fase 2 solo arranca con Fase 1 verde; Fase 3 solo con Fase 2 verde.
- **No modificas `arch/`** ni lees nada bajo `arch/review/`.
