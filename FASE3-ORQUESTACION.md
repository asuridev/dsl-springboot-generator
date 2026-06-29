# Fase 3 — Orquestación multi-agente

Este documento explica, en detalle y en lenguaje llano, cómo funciona la reestructuración
de la Fase 3 del pipeline DSL: de **un solo agente que hacía todo** a **un orquestador que
coordina cinco agentes especializados**.

---

## 0. Primero: ¿qué es un "DAG"?

**DAG** son las siglas en inglés de *Directed Acyclic Graph* → en español, **grafo dirigido
acíclico**. Suena complicado, pero la idea es simple. Descompongámoslo:

- **Grafo** = un conjunto de cajitas (tareas) unidas por flechas.
- **Dirigido** = las flechas tienen sentido: van de una tarea a la siguiente. Indican
  **el orden** y **quién depende de quién**.
- **Acíclico** = no hay ciclos. Es decir, nunca puedes seguir las flechas y volver a una
  tarea por la que ya pasaste. El trabajo siempre **avanza**, nunca gira en círculos.

En palabras simples: **un DAG es un mapa de tareas que dice qué se hace primero, qué se hace
después, y qué cosas se pueden hacer al mismo tiempo, sin volver nunca hacia atrás.**

Una analogía cotidiana: **preparar un desayuno**.

```
   [Calentar sartén]        [Sacar huevos de la nevera]
          │                          │
          └──────────┬───────────────┘
                     ▼
              [Freír los huevos]
                     │
                     ▼
                [Servir el plato]
```

- "Calentar sartén" y "sacar huevos" **no dependen entre sí** → puedes hacerlas **en
  paralelo** (a la vez).
- "Freír los huevos" **depende de ambas** → solo empieza cuando las dos terminaron.
- Las flechas siempre van hacia adelante; nunca vuelves a "calentar la sartén" después de
  servir. Eso lo hace **acíclico**.

Nuestra Fase 3 es exactamente eso: un mapa de tareas (agentes) con un orden y con partes que
corren en paralelo. Ese mapa es el DAG.

---

## 1. ¿Qué cambió y por qué?

### Antes (monolítico)

Había **un único agente** (`logic-implementation`) que, él solo y en orden lineal, hacía
**todo**: verificaba que el proyecto compilara, levantaba la infraestructura, implementaba la
lógica de negocio (`// TODO`), validaba cada caso de uso y generaba las colecciones Postman.

Problema: todo iba mezclado en un solo hilo de trabajo. Implementar y validar estaban
entrelazados, y un único agente cargaba con responsabilidades muy distintas.

### Ahora (orquestación multi-agente)

Separamos el trabajo en **un orquestador + cinco especialistas**, cada uno experto en una
sola cosa. El orquestador no programa: **coordina**. Lanza a los especialistas en el orden
correcto (el DAG), espera sus resultados y habla con el usuario.

Ventajas:
- Cada especialista hace **una sola cosa y la hace bien**.
- Las tareas independientes corren **en paralelo** (más rápido).
- El flujo es **predecible**: una fase no empieza hasta que la anterior terminó bien.
- **Portable**: funciona igual en Claude Code y en otros harnesses de agentes.

---

## 2. Una skill orquestadora + cinco agentes especialistas

| Componente | Tipo | Qué hace |
|---|---|---|
| **`logic-implementation`** | Skill orquestadora | Coordina todo el DAG. Es el **único que habla con el usuario**. No escribe lógica de negocio. La invoca el agente principal (no es un agente ni un slash command). |
| **`todo-implementer`** | Especialista (agente) | Completa los `// TODO: implement business logic` (handlers, aggregates, domain services). Deja el proyecto **compilando**. |
| **`infra-provisioner`** | Especialista | Levanta la infraestructura con Docker/Podman (base de datos, broker, cache, Keycloak, MinIO…) y la verifica. |
| **`flow-validator`** | Especialista | Valida **todos los escenarios** de cada flujo de `{bc}-flows.md` contra la app corriendo, y corrige hasta que todo pasa. |
| **`java-quality-auditor`** | Especialista | Audita y mejora la **calidad del código Java** (imports, inyección de dependencias, buenas prácticas) sin cambiar el comportamiento. |
| **`postman-builder`** | Especialista | Genera las colecciones **Postman** para revalidar los flujos manualmente. |

> Un detalle clave: **los especialistas nunca le preguntan nada al usuario**. Si encuentran un
> problema que no pueden resolver (una contradicción en el diseño, una dependencia no
> declarada, etc.), lo **reportan** al orquestador y terminan. Es el orquestador quien decide
> detenerse y preguntarle al usuario. Así hay un único interlocutor y nadie se pisa.

---

## 3. El DAG de la Fase 3 (el mapa completo)

```
                    ┌─────────────────────────────────────┐
                    │           ORQUESTADOR                │
                    │  Pre-flight:                         │
                    │   1. Identifica el bounded context   │
                    │   2. ./gradlew compileJava (compila) │
                    └───────────────────┬──────────────────┘
                                        │
        ╔═══════════════ FASE 1 — en paralelo ═══════════════╗
        ▼                                                     ▼
┌────────────────────┐                       ┌─────────────────────────┐
│  todo-implementer  │                       │   infra-provisioner     │
│  completa los      │                       │  levanta docker/podman  │
│  // TODO y compila │                       │  compose y lo verifica  │
└─────────┬──────────┘                       └────────────┬────────────┘
          │                                                │
          └──────────── esperar a que AMBOS terminen ──────┘
                                        │
        ╔═══════════ FASE 2 — secuencial (1 a la vez) ════════╗
                                        ▼
                  ┌──────────────────────────────────┐
                  │          flow-validator           │
                  │  valida TODOS los escenarios de   │
                  │  {bc}-flows.md e itera hasta que   │
                  │  todos pasan (camino feliz +       │
                  │  errores/bordes)                   │
                  └─────────────────┬──────────────────┘
                                    │
        ╔═══════════════ FASE 3 — en paralelo ════════════════╗
        ▼                                                     ▼
┌────────────────────┐                       ┌─────────────────────────┐
│ java-quality-auditor│                       │    postman-builder      │
│ mejora la calidad   │                       │  genera las colecciones │
│ del código Java     │                       │  Postman                │
└─────────┬──────────┘                       └────────────┬────────────┘
          │                                                │
          └──────────── esperar a que AMBOS terminen ──────┘
                                        │
                                        ▼
                          ┌──────────────────────────┐
                          │   Reporte final al usuario │
                          └──────────────────────────┘
```

### Recorrido paso a paso

**Pre-flight (antes de lanzar nada).** El orquestador averigua sobre qué bounded context se va
a trabajar (si no se lo dijiste, te lo pregunta) y corre `./gradlew compileJava` para asegurar
que el proyecto compila. Nunca lanza un especialista sobre código roto.

**Fase 1 — en paralelo.** Lanza a la vez:
- `todo-implementer`, que completa toda la lógica de negocio pendiente.
- `infra-provisioner`, que levanta la infraestructura.

Estas dos tareas **no dependen entre sí**, por eso van juntas. El orquestador **espera a que
ambas terminen**. Si alguna reporta un bloqueo, se detiene y te pregunta.

**Fase 2 — secuencial.** Cuando el código está implementado **y** la infraestructura está
arriba, lanza `flow-validator`. Este necesita las dos cosas a la vez (código + infra), por eso
no puede empezar antes. Ejecuta cada escenario de cada flujo contra la app real y corrige
hasta dejarlos todos en verde.

**Fase 3 — en paralelo.** Con todos los flujos validados, lanza a la vez:
- `java-quality-auditor`, que pule el código Java.
- `postman-builder`, que escribe las colecciones Postman.

¿Por qué pueden ir juntos sin problema? Porque **tocan archivos distintos**: el auditor edita
`.java` y el builder solo escribe `.json` en la carpeta `postman/`. No hay choque.

**Cierre.** El orquestador junta los resultados de los cinco agentes y te da un reporte final.

---

## 4. Las reglas del DAG (las dependencias)

El orden no es decorativo: cada flecha es una **dependencia real** que el orquestador respeta.

- **Fase 2 solo arranca si la Fase 1 quedó verde**: `flow-validator` necesita que el código
  compile (`todo-implementer` devolvió `compiles: true`) **y** que la infraestructura esté lista
  (`infra-provisioner` devolvió `status: ready`). No se puede validar sin las dos cosas.
- **Fase 3 solo arranca si la Fase 2 quedó verde**: no tiene sentido pulir el código ni generar
  Postman si los flujos todavía fallan.
- **El auditor de calidad no debe romper lo ya validado**: solo hace cambios "no-conductuales"
  (que no cambian el comportamiento) y vuelve a compilar al terminar.

---

## 5. El "contrato de handoff" (cómo se pasan el testigo)

Cada especialista devuelve al orquestador un resultado estructurado. Así el orquestador sabe
si puede avanzar o si debe detenerse y preguntarte.

| Especialista | Qué devuelve |
|---|---|
| `infra-provisioner` | `{ status: ready\|failed, runtime, services[], blockers[] }` |
| `todo-implementer` | `{ todosImplemented, compiles, domainServices[], blockers[] }` |
| `flow-validator` | `{ flows[{id, scenarios{A,B,…}}], failures[], blockers[] }` |
| `java-quality-auditor` | `{ issuesFixed[], compiles, remaining[] }` |
| `postman-builder` | `{ files[], rolesCovered[], blockers[] }` |

- **`blockers[]`** = problemas que requieren una decisión humana (el orquestador te pregunta).
- **`failures[]`** = escenarios que no se pudieron dejar en verde.
- **`remaining[]`** = mejoras de calidad que implicarían cambiar comportamiento → se reportan,
  no se aplican.

---

## 6. ¿Cómo "funciona" esto en la práctica? (portabilidad)

La **forma del DAG** (qué agente, en qué orden, qué corre en paralelo) es **idéntica en todos
los harnesses**. Lo único que cambia es **cómo se lanza cada agente**. Esto se gestiona al
generar el proyecto (`dsl-springboot build`), que despliega los agentes en tres formatos:

### En Claude Code
- El **orquestador** se despliega como una **skill** auto-descubierta:
  `.claude/skills/logic-implementation/SKILL.md`. Siguiendo la recomendación de Anthropic (skills por
  encima de slash commands), la invoca el **agente principal** según su `description` —corre en el
  hilo principal, donde `AskUserQuestion` y `Task` funcionan de forma nativa.
- Los **cinco especialistas** se despliegan como **subagentes**: `.claude/agents/*.md`.
- El orquestador los lanza con el tool **`Task`**. Para correr dos en paralelo (Fases 1 y 3),
  emite las dos llamadas `Task` en el mismo turno.
- **Uso**: pídelo en lenguaje natural, por ejemplo "implementa el BC catalog" o "completa los TODO
  del bounded context orders"; el agente principal carga la skill `logic-implementation`. (Ya no es
  un slash command `/logic-implementation`.)

### En otros harnesses (`.github/agents/`, `.agents/`)
- Los mismos archivos de agente se publican tal cual.
- La lógica de coordinación está escrita en **prosa agnóstica**: "lanza el agente X y el agente
  Y en paralelo; cuando ambos terminen, lanza Z…". Cada runtime la mapea a su propio mecanismo
  de subagentes.
- Si un harness no soporta paralelismo real, ejecuta los pares de la Fase 1 y la Fase 3 de
  forma secuencial respetando las mismas dependencias — el resultado es equivalente.

---

## 7. ¿Dónde está cada cosa? (mapa de archivos)

### Fuente (en este generador)

```
src/agents/                            ← solo los 5 especialistas (kind: specialist)
├── todo-implementer.agent.md
├── infra-provisioner.agent.md
├── flow-validator.agent.md
├── java-quality-auditor.agent.md
└── postman-builder.agent.md

src/skills/                            ← una skill por concern (el deployer copia todo el árbol)
├── logic-implementation/SKILL.md      ← skill orquestadora: punto de entrada del usuario (el DAG)
├── orchestration/SKILL.md             ← skill compartida: pipeline, DAG, handoffs, harness, reglas
├── handler-implementation/            ← detalle del todo-implementer
│   ├── SKILL.md
│   └── references/
│       ├── bc-artifacts-guide.md      ← cómo leer YAML / flows.md
│       ├── domain-service-patterns.md
│       ├── virtual-threads-in-handlers.md
│       └── storage-integration-patterns.md
├── infra-provisioning/                ← detalle del infra-provisioner
│   ├── SKILL.md
│   └── references/infra-validation-guide.md   ← comandos CLI por servicio
├── flow-validation/SKILL.md           ← detalle del flow-validator (cross-ref infra + handler)
├── java-quality-audit/SKILL.md        ← checklist de calidad Java
└── postman-authoring/                 ← detalle del postman-builder
    ├── SKILL.md
    └── references/postman-collection-guide.md

src/commands/build.js                  ← copia src/skills a los 3 harness; src/agents → .github/agents
src/utils/claude-code-deployer.js      ← copia skills a .claude/skills; especialistas → .claude/agents
```

El **orquestador es una skill** (`src/skills/logic-implementation/`), auto-descubierta e invocada por
el agente principal — no tiene `kind`. Los **especialistas** son agentes con `kind: specialist`, que
el deployer enruta a subagentes (`.claude/agents/`) y se copian verbatim a `.github/agents/`.

### Resultado (en el proyecto generado)

```
.claude/
├── agents/                            ← los 5 especialistas como subagentes
│   ├── todo-implementer.md
│   ├── infra-provisioner.md
│   ├── flow-validator.md
│   ├── java-quality-auditor.md
│   └── postman-builder.md
└── skills/
    ├── logic-implementation/SKILL.md  ← orquestador como skill (Task + AskUserQuestion)
    └── …                              ← orchestration + las 5 skills de referencia

.github/agents/   ← los 5 especialistas (agentes) para harnesses estilo GitHub
.github/skills/   ← las skills (incl. el orquestador) para el harness GitHub
.agents/skills/   ← las skills (incl. el orquestador) para harnesses genéricos
```

---

## 8. Resumen en una frase

La Fase 3 dejó de ser **un agente que hacía todo en fila** y pasó a ser **un orquestador que
reparte el trabajo entre cinco especialistas siguiendo un mapa de dependencias (el DAG)**:
primero implementa y levanta infra en paralelo, luego valida todos los flujos, y finalmente
pule el código y genera Postman en paralelo — deteniéndose a preguntarte solo cuando hace falta.
