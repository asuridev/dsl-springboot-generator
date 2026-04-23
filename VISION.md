# Visión del Sistema — DSL de Diseño con Generación Determinística

## ¿Qué estamos construyendo?

Un mecanismo de tres fases para construir software de forma coherente, trazable y reproducible:

```
Fase 1: Diseño           Fase 2: Generación            Fase 3: Implementación
─────────────────────    ───────────────────────────   ─────────────────────────────
  Humano + IA        →     Generador               →     IA en contexto acotado
  Artefactos YAML          determinístico                Completa la lógica de
  agnósticos               Scaffolding + skeletons       negocio compleja
  Todas las decisiones     con // TODO para la           Solo recibe artefactos
  de dominio               lógica compleja               del BC — sin decisiones
```

El diseño produce artefactos. El generador consume artefactos. Nunca al revés.

---

## Qué resuelve cada fase

**Fase 1 — Diseño (Humano + IA):** Todas las decisiones de dominio y arquitectura. El human-in-the-loop ocurre aquí. Al aprobar el diseño táctico, el humano decide qué es un Agregado, qué estados tiene, qué invariantes se cumplen, qué eventos cruzan BCs y qué contratos expone el sistema.

**Fase 2 — Generación determinística:** El generador produce scaffolding completo para la tecnología objetivo: clases, DTOs, mappers, interfaces de repositorio, controladores, configuración de DI, migraciones de base de datos. Para los casos de uso con `implementation: scaffold`, el generador produce el esqueleto del método con `// TODO: implement business logic — ver {bc-name}-flows.md` en lugar de la implementación real.

**Fase 3 — Implementación (IA en contexto acotado):** Un agente de IA recibe exclusivamente los artefactos del BC (`{bc-name}.yaml`, `{bc-name}-flows.md`, `{bc-name}-spec.md`) y completa la lógica de negocio no trivial en los métodos marcados con `// TODO`. No toma decisiones de arquitectura — solo implementa lo que el diseño especificó. El `{bc-name}-flows.md` es su especificación ejecutable.

---

## Principio fundamental: separación intención / implementación

Los artefactos de diseño declaran **qué** y **para qué**. Nunca **cómo**.

| El artefacto declara | El generador decide |
|---|---|
| `auditable: true` | columnas `created_at`/`updated_at`, anotaciones JPA, triggers SQL |
| `readOnly: true` + `defaultValue: generated` | UUID v4 en factory, autoincrement, secuencia |
| `derived_from: name` | función Slugify, evento de dominio, columna generada |
| `source: auth-context` | inyección desde `SecurityContext`, JWT claim, middleware |
| `hidden: true` | exclusión del serializador, bcrypt, campo sin getter en DTO |
| `indexed: true` | índice B-Tree, índice compuesto, anotación `@Index` |
| `type: uniqueness` en domain_rule | constraint UNIQUE en DB + `findBy{Campo}` en repositorio |
| `relationship: composition` | tabla hija con FK cascade delete, `@OneToMany(orphanRemoval)` |

El mismo artefacto YAML debe poder alimentar un generador para Spring Boot + PostgreSQL,
otro para Django + PostgreSQL, y otro para NestJS + TypeORM, produciendo código idiomático
en cada caso sin cambiar una sola línea del diseño.

---

## Las decisiones importantes se toman en diseño, no en código

El human-in-the-loop ocurre en la **Fase 1**. Cuando el humano aprueba el diseño táctico,
está tomando decisiones que el generador no puede tomar por él:

- ¿Qué es un Agregado y qué es una Entidad subordinada?
- ¿Qué estados tiene el ciclo de vida de este concepto de negocio?
- ¿Qué invariantes debe hacer cumplir el sistema siempre?
- ¿Qué eventos de dominio cruzan bounded contexts?
- ¿Qué contratos de API expone este BC hacia afuera vs hacia otros BCs internos?
- ¿Qué datos son críticos para el negocio y cuáles son detalles de implementación?

Una vez aprobado el diseño, el generador es determinístico: dado el mismo artefacto YAML,
produce siempre el mismo código. No hay ambigüedad, no hay decisiones implícitas, no hay
"el generador interpretó diferente".

---

## Estructura de los artefactos

### Paso 1 — Diseño Estratégico (`arch/system/`)

Responde: ¿Qué bounded contexts existen? ¿Cómo se relacionan?

```
arch/system/
├── system.yaml          ← fuente de verdad: BCs, integraciones, infraestructura
├── system-spec.md       ← narrativa del dominio por BC
└── system-diagram.mmd   ← diagrama C4 nivel contenedores
```

### Paso 2 — Diseño Táctico (`arch/{bc-name}/`)

Responde: ¿Qué hay dentro de cada bounded context?

```
arch/{bc-name}/
├── {bc-name}.yaml              ← anatomía del dominio (fuente de verdad para el generador)
├── {bc-name}-spec.md           ← casos de uso detallados
├── {bc-name}-flows.md          ← flujos Given/When/Then (especificación de tests)
├── {bc-name}-open-api.yaml     ← contrato REST público
├── {bc-name}-internal-api.yaml ← contrato REST BC-a-BC (condicional)
├── {bc-name}-async-api.yaml    ← contrato de eventos (AsyncAPI)
└── diagrams/                   ← diagramas de estados, dominio, secuencias
```

### Paso 3 — Generación e Implementación (Fases 2 y 3)

Entrada: `{bc-name}.yaml` v2 (enriquecido con `useCases`, `repositories`, `errors`).
Salida Fase 2: scaffolding completo para la tecnología objetivo. Los casos de uso con `implementation: scaffold` generan el esqueleto del método con `// TODO: implement business logic`.
Salida Fase 3: la IA completa los `// TODO` usando `{bc-name}-flows.md` como especificación ejecutable.

---

## Propiedades que el sistema debe garantizar

**Coherencia**: Todo lo que existe en el código tiene su origen trazable en el diseño.
No hay clases, endpoints ni eventos que no estén declarados en los artefactos YAML.

**Determinismo**: El mismo artefacto produce el mismo código en cada ejecución.
El generador no tiene memoria, no toma decisiones, no "mejora" el diseño.

**Agnosticismo tecnológico**: Los artefactos no contienen referencias a frameworks,
librerías ni patrones de implementación específicos. La tecnología es una variable
de entrada al generador, no del diseño.

**Trazabilidad**: Cada elemento generado — clase, método, endpoint, tabla, índice,
evento — puede rastrearse hasta su origen en el YAML:
- `derived_from: implicit` → implícito por convención DDD
- `derived_from: CAT-RULE-003` → generado por esta regla de dominio específica
- `derived_from: openapi:listProducts` → generado por este operationId del OpenAPI

**Completitud**: El `{bc-name}.yaml` v2 contiene toda la información que el generador
necesita. No requiere leer otros archivos, consultar al humano ni hacer inferencias.

---

## Lo que este sistema no es

- No es un ORM ni un framework
- No es un generador de CRUD genérico
- No sustituye el juicio del diseñador sobre el dominio de negocio
- No toma decisiones de arquitectura que no hayan sido aprobadas por el humano
- No genera código que no tenga origen trazable en el diseño

---

## Cómo este documento debe usarse

Cualquier ajuste al proceso de diseño, a los skills de generación de artefactos,
o al schema del YAML debe evaluarse contra estos criterios:

1. ¿El cambio mantiene la separación intención / implementación?
2. ¿El diseño sigue siendo agnóstico a la tecnología después del cambio?
3. ¿La información nueva en el YAML es suficiente para que el generador actúe sin ambigüedad?
4. ¿El humano sigue teniendo control sobre las decisiones de dominio importantes?

Si la respuesta a cualquiera de estas preguntas es "no", el cambio debe revisarse.
