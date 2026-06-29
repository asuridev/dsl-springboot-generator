---
name: orchestration
description: >
  Referencia compartida de la Fase 3 del pipeline DSL, consultada por la skill de orquestación
  `logic-implementation` (el punto de entrada del usuario) y por los agentes especialistas. Define el
  DAG multi-agente, los roles, el contrato de handoff entre orquestador y especialistas, la adaptación
  por harness y —para TODOS los agentes— las reglas inviolables y los criterios de "cuándo detenerse".
  No es el punto de entrada del usuario: esta skill debe consultarse cuando se necesite coordinar el
  DAG de la Fase 3, conocer qué recibe y devuelve cada especialista, o aplicar las reglas compartidas
  al implementar o validar un bounded context.
---

> **Skills hermanas:** los especialistas tienen su propia skill de detalle —
> `handler-implementation`, `infra-provisioning`, `flow-validation`, `java-quality-audit`,
> `postman-authoring`— en `.agents/skills/{nombre}/` desde la raíz del proyecto. **Esta skill
> (`orchestration`) es la compartida**: el orquestador la lee completa; cada especialista lee al
> menos sus secciones "Reglas inviolables" y "Cuándo detenerse".

# Fase 3 — Orquestación de la implementación de lógica de negocio

La Fase 3 no es un único flujo lineal: es un **DAG orquestado** de agentes especializados, cada uno
responsable de una parte del trabajo. El **orquestador** (`logic-implementation`) coordina el DAG y
es el único que dialoga con el usuario; los **especialistas** ejecutan su parte de forma
no-interactiva y devuelven un resultado estructurado.

## Contexto del pipeline

```
Fase 1: Diseño (humano + IA)  →  Fase 2: Generador determinístico  →  Fase 3: orquestación
    arch/{bc-name}.yaml              scaffold + // TODO handlers            multi-agente
    {bc-name}-flows.md               UnsupportedOperationException          (esta skill)
    contratos API/eventos            wiring generado
```

El `{bc-name}-flows.md` es la **especificación ejecutable**: cada flujo `FL-{BC}-{N}` puede tener
varios escenarios (A, B, C…) —el feliz y los de error/borde— y **todos** deben quedar implementados
y validados, no solo el primero. Las convenciones de arquitectura están en `AGENTS.md`.

## El DAG

```
                ORQUESTADOR  (pre-flight: identifica BC + ./gradlew compileJava)
        ── Fase 1 (paralelo) ───────────────────────────────────────────
        todo-implementer  (Pasos A,B,C,C2,D,E)   ║   infra-provisioner (Paso 0b)
        ── Fase 2 (secuencial, requiere F1 verde) ──────────────────────
        flow-validator    (Paso F: todos los escenarios, fix-loop)
        ── Fase 3 (paralelo, requiere F2 verde) ────────────────────────
        java-quality-auditor (calidad Java)      ║   postman-builder (Paso G)
        ── Cierre ──────────────────────────────────────────────────────
        Reporte final al usuario
```

### Invariantes del DAG
- **Pre-flight obligatorio**: el orquestador determina el BC y deja el árbol compilando antes de
  lanzar nada. Nunca se lanza un especialista sobre código que no compila.
- **Fase 1 → Fase 2**: `flow-validator` solo arranca cuando `todo-implementer` devolvió
  `compiles: true` **y** `infra-provisioner` devolvió `status: ready`. Ambos son prerequisitos: no
  se puede validar sin código implementado ni sin infraestructura.
- **Fase 2 → Fase 3**: la calidad y Postman solo arrancan con todos los escenarios verdes.
- **Paralelismo seguro en Fase 3**: `java-quality-auditor` edita `.java`; `postman-builder` solo
  escribe JSON en `postman/`. No comparten archivos, por eso corren a la vez sin conflicto.
- **El auditor no debe romper lo validado**: solo cambios no-conductuales y re-compila al cerrar
  (ver skill `java-quality-audit`).

## Roles

| Agente | Responsabilidad | Skill de detalle |
|---|---|---|
| `logic-implementation` (orquestador) | Coordina el DAG, surfacea bloqueos al usuario | esta skill (`orchestration`) |
| `todo-implementer` | Completa los `// TODO` (Pasos A–E + C2), deja el proyecto compilando | `handler-implementation` |
| `infra-provisioner` | Levanta y verifica la infraestructura (Paso 0b) | `infra-provisioning` |
| `flow-validator` | Valida **todos** los escenarios de cada flujo end-to-end (Paso F) | `flow-validation` (+ `infra-provisioning`, `handler-implementation`) |
| `java-quality-auditor` | Audita y ajusta la calidad del código Java (no-conductual) | `java-quality-audit` |
| `postman-builder` | Emite las colecciones Postman (Paso G) | `postman-authoring` |

---

## Contrato de handoff

Cada especialista es **no-interactivo**: nunca usa `AskUserQuestion`. Recibe del orquestador, como
mínimo, el **nombre del bounded context**, y devuelve un resultado estructurado. Si encuentra un
motivo de "cuándo detenerse" (ver más abajo), lo registra en `blockers[]` y termina; **el
orquestador** decide entonces detener el DAG y consultar al usuario.

| Especialista | Entrada | Salida |
|---|---|---|
| `infra-provisioner` | bc-name (contexto) | `{ status: ready\|failed, runtime, services: [{name,state}], blockers[] }` |
| `todo-implementer` | bc-name | `{ todosImplemented, compiles, domainServices[], blockers[] }` |
| `flow-validator` | bc-name | `{ flows: [{id, scenarios:{A,B,…}}], failures[], blockers[] }` |
| `java-quality-auditor` | bc-name | `{ issuesFixed[], compiles, remaining[] }` |
| `postman-builder` | bc-name | `{ files[], rolesCovered[], blockers[] }` |

### Gating que aplica el orquestador
- Tras **Fase 1**: si `todo-implementer.blockers` o `infra-provisioner.status == failed` → detener
  y `AskUserQuestion`.
- Tras **Fase 2**: si `flow-validator.failures` no resueltos o `flow-validator.blockers` → detener
  y llevar el detalle al usuario; no avanzar a Fase 3 con escenarios en rojo.
- Tras **Fase 3**: consolidar `java-quality-auditor.remaining` y `postman-builder` en el reporte
  final.

---

## Adaptación por harness

La **topología** (qué especialista, en qué orden, con qué dependencias) es idéntica en todos los
harnesses. Solo cambia el **mecanismo de spawn**.

### Claude Code
- Los especialistas se despliegan como **subagentes** en `.claude/agents/` (uno por archivo
  `*.agent.md` con `kind: specialist`). El orquestador se despliega como **slash command** en
  `.claude/commands/logic-implementation.md` (corre en el hilo principal, donde funcionan
  `AskUserQuestion` y `$ARGUMENTS`).
- Para lanzar un especialista, el orquestador usa el tool **`Task`** indicando el `subagent_type`
  correspondiente (`todo-implementer`, `infra-provisioner`, `flow-validator`,
  `java-quality-auditor`, `postman-builder`).
- Para **paralelizar** (Fase 1 y Fase 3), emite las dos llamadas `Task` **en el mismo turno**
  (varios tool calls en un solo mensaje). El runtime las ejecuta concurrentemente y el orquestador
  recibe ambos resultados antes de continuar.
- El orquestador recoge el resultado de cada `Task` (el mensaje final del subagente) y aplica el
  gating de arriba. Solo el orquestador habla con el usuario.

### Otros harnesses (`.github/agents/`, `.agents/`)
- Los mismos archivos `*.agent.md` se publican verbatim. Cada runtime mapea "lanzar el agente X" a
  su propio mecanismo de subagentes/sub-tareas.
- La instrucción es **agnóstica**: "lanza el agente `todo-implementer` y el agente
  `infra-provisioner` en paralelo; cuando ambos terminen y compile + infra estén listos, lanza
  `flow-validator`; cuando todos los escenarios estén verdes, lanza `java-quality-auditor` y
  `postman-builder` en paralelo; finalmente reporta".
- Si un runtime no soporta paralelismo real, ejecuta los pares de Fase 1 y Fase 3 de forma
  secuencial respetando las mismas dependencias; el resultado es equivalente.
- El rol de "único interlocutor con el usuario" lo mantiene el orquestador: los especialistas
  devuelven `blockers[]`/`failures[]` y nunca preguntan.

---

## Reglas inviolables (compartidas por TODOS los agentes)

1. **No se modifica `arch/`** — solo se leen artefactos de diseño, nunca se alteran.
2. **No se toman decisiones de dominio** — si el flujo no cubre un caso, detenerse y notificar.
3. **No se añaden campos, DTOs ni endpoints** que no estén en el YAML.
4. **No se cambian firmas de métodos** de handlers, aggregates ni repositorios generados.
5. **Cada paso implementado debe ser trazable** al flujo correspondiente en `flows.md`.
6. Las convenciones de código (sin Lombok en dominio, sin setters, constructores, etc.) están en
   `AGENTS.md` — se siguen sin excepción.
7. **No se implementan tests de negocio en Fase 3.** Se puede compilar o correr checks existentes
   para validar imports y wiring, pero no crear nuevos tests salvo instrucción explícita.
8. **Definición de "completado":** un UC solo está completo cuando su flujo se validó vía Paso F3
   (ejecución real + side effects esperados) para **todos** sus escenarios. Compilar **no** es
   completar.
9. **Aislamiento de bounded contexts (rompe la arquitectura si se viola):** un handler, aggregate o
   domain service de un BC **NUNCA** inyecta ni referencia un repositorio, entidad JPA, aggregate o
   clase de dominio de **otro** BC. La comunicación entre BCs ocurre **exclusivamente** a través de
   las `integrations:` declaradas en `{bc-name}.yaml` (adapters HTTP/ACL salientes, eventos async,
   internal-API). Si un flujo parece requerir datos de otro BC y no hay integración declarada,
   detenerse y notificar — no inyectar su repositorio.

---

## Cuándo detenerse y notificar (compartido por TODOS los agentes)

Un especialista **no pregunta al usuario**: registra el bloqueo en `blockers[]` y termina. El
orquestador decide cuándo detener el DAG y consultar con `AskUserQuestion`. Son motivos de bloqueo:

- Un flujo de `flows.md` que contradice lo declarado en `{bc-name}.yaml`.
- Un paso del `Then` que requiere información no disponible en los artefactos del BC.
- Un UC marcado con `implementation: scaffold` cuyo flujo no existe en `flows.md`.
- Una dependencia con otro BC no declarada en `{bc-name}.yaml` bajo `integrations:`.
- Cualquier archivo necesario dentro de `arch/review/`.

No inferir, no completar por cuenta propia. Notificar con precisión qué falta y por qué es necesario.

---

## Skills de la Fase 3

| Skill | Leer cuando... |
|---|---|
| `orchestration` (esta) | Coordinas el DAG, o necesitas las reglas inviolables / handoff / harness |
| `handler-implementation` | Completas los `// TODO`: estructura de `flows.md`/`{bc-name}.yaml`, domain services, hilos virtuales, storage |
| `infra-provisioning` | Levantas/verificas infraestructura o necesitas los comandos CLI exactos por servicio |
| `flow-validation` | Validas end-to-end todos los escenarios de cada flujo (Paso F, fix-loop) |
| `java-quality-audit` | Auditas la calidad del código Java (imports, DI, buenas prácticas, frontera no-conductual) |
| `postman-authoring` | Generas el Paso G: estructura JSON de las colecciones Postman |
| `AGENTS.md` (raíz del proyecto) | Necesitas confirmar una convención de código o arquitectura |
