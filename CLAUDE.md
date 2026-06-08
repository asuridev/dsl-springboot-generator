# AGENTS.md — dsl-springboot-generator

## Propósito de este documento

Guía autoritativa para agentes de IA que trabajen en este proyecto.
Describe qué es este proyecto, qué hace, qué consume, qué produce y qué reglas son inviolables.

---

## ¿Qué es este proyecto?

`@dsl/springboot-generator` es la **Fase 2** de un pipeline de tres fases:

```
Fase 1: Diseño           Fase 2: Este proyecto         Fase 3: Implementación
─────────────────────    ──────────────────────────    ─────────────────────────
  Humano + IA        →   dsl-springboot-generator  →   IA completa lógica
  Artefactos YAML         lee arch/{bc-name}.yaml       en métodos // TODO
  en arch/                produce scaffolding Java
```

Este proyecto es **exclusivamente un generador de código**. No diseña, no decide, no infiere.
Consume artefactos YAML de diseño y produce código Spring Boot idiomático y determinístico.

---

## Estructura del proyecto

```
dsl-springboot-generator/
├── bin/
│   └── dsl-springboot.js     ← entry point CLI (commander)
├── src/
│   ├── commands/             ← un archivo por subcomando CLI
│   ├── generators/           ← lógica de generación de código por tipo de artefacto
│   └── utils/
│       └── logger.js         ← wrapper de chalk (info/success/warn/error)
├── templates/                ← templates EJS que producen código Java
├── arch/                     ← artefactos de diseño (INPUT del generador)
│   ├── system/               ← diseño estratégico
│   └── {bc-name}/            ← diseño táctico por bounded context
└── VISION.md                 ← visión del sistema completo
```

---

## Los artefactos de diseño (INPUT)

El generador lee exclusivamente desde `arch/`. **No modifica estos archivos.**

### Diseño estratégico — `arch/system/`

| Archivo | Contenido |
|---|---|
| `system.yaml` | Fuente de verdad: bounded contexts, integraciones, infraestructura |
| `system-spec.md` | Narrativa del dominio por BC (referencia humana, no procesada) |
| `system-diagram.mmd` | Diagrama C4 (referencia humana, no procesada) |

### Diseño táctico — `arch/{bc-name}/`

| Archivo | Contenido | ¿Procesado por el generador? |
|---|---|---|
| `{bc-name}.yaml` | **Fuente de verdad principal** — enums, value objects, aggregates, entities, use cases, repositories, errors | ✅ Sí |
| `{bc-name}-open-api.yaml` | Contrato REST público | ✅ Sí (controllers, DTOs) |
| `{bc-name}-internal-api.yaml` | Contrato REST BC-a-BC | ✅ Sí (condicional) |
| `{bc-name}-async-api.yaml` | Contrato de eventos (AsyncAPI) | ✅ Sí (producers/consumers) |
| `{bc-name}-spec.md` | Casos de uso detallados | ❌ No (referencia humana) |
| `{bc-name}-flows.md` | Flujos Given/When/Then | ❌ No (referencia para Fase 3) |
| `diagrams/` | Diagramas de estados y secuencias | ❌ No (referencia humana) |

### Directorio excluido — `arch/review/`

`arch/review/` **nunca debe ser leído ni procesado** por el generador.
Contiene artefactos en revisión que aún no han sido aprobados por el humano.
Si un agente de IA intenta leer de `arch/review/`, debe detenerse y notificar al usuario.

---

## Lo que el generador produce (OUTPUT)

Scaffolding completo de Spring Boot siguiendo **arquitectura hexagonal (puertos y adaptadores)** con **DDD** y **CQRS**:

```
src/main/java/{package}/{bc-name}/
├── domain/
│   ├── models/
│   │   ├── entities/        ← entidades de dominio (sin Lombok, sin setters)
│   │   ├── valueObjects/    ← value objects inmutables
│   │   └── enums/           ← enumeraciones con transiciones de estado
│   └── repositories/        ← interfaces de repositorio (puertos de salida)
├── application/
│   ├── commands/            ← objetos de comando (CQRS)
│   ├── queries/             ← objetos de query (CQRS)
│   ├── usecases/            ← handlers: método execute() con // TODO si implementation: scaffold
│   ├── mappers/             ← mappers application ↔ domain
│   └── dtos/                ← DTOs de entrada y salida
└── infrastructure/
    ├── database/
    │   ├── entities/        ← entidades JPA (con Lombok, @Entity)
    │   └── repositories/    ← implementaciones JPA de los puertos
    ├── adapters/            ← adaptadores externos (HTTP Exchange, Kafka, RabbitMQ)
    └── controllers/         ← REST controllers
```

---

## Reglas de generación inviolables

### 1. El generador no toma decisiones de dominio

Si el YAML no especifica algo, el generador usa la convención registrada en este documento.
Si la convención tampoco cubre el caso, el generador debe **detenerse y notificar al usuario**, no inferir.

### 2. Determinismo estricto

El mismo `{bc-name}.yaml` produce siempre el mismo código.
No hay aleatoriedad, no hay "mejoras" implícitas, no hay variantes según contexto.

### 3. Trazabilidad obligatoria

Cada elemento generado debe tener su origen declarado en el YAML.
Los comentarios `// derived_from: {origin}` se generan para clases y métodos cuyo origen es una regla de dominio.

### 4. Casos de uso con `implementation: scaffold`

El método `execute()` del handler se genera con:
```java
// TODO: implement business logic — ver {bc-name}-flows.md
throw new UnsupportedOperationException("Not implemented yet");
```

Los casos de uso **sin** `implementation: scaffold` (implementación trivial tipo CRUD) se generan completos.

### 5. Entidades de dominio

- Sin Lombok
- Sin constructor vacío
- Sin setters públicos
- Solo métodos de negocio para modificar estado
- Getters públicos para todos los campos
- Constructor de reconstrucción (todos los campos) + constructor de creación (sin id ni audit fields)

### 6. Entidades JPA (infraestructura)

- Con Lombok: `@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder`
- Extienden `FullAuditableEntity` si el agregado tiene `auditable: true`
- Nombre: `{EntityName}Jpa`

### 7. Separación intención / implementación

Los artefactos YAML declaran **qué** y **para qué**. El generador decide **cómo**:

| El YAML declara | El generador genera |
|---|---|
| `auditable: true` | columnas `created_at`/`updated_at`, anotaciones JPA, extend `FullAuditableEntity` |
| `readOnly: true` + `defaultValue: generated` | UUID v4 en factory, sin setter, sin parámetro en constructor de creación |
| `derived_from: {field}` | lógica derivada en el método de negocio correspondiente |
| `source: auth-context` | inyección desde `SecurityContext` en el handler |
| `hidden: true` | campo excluido de DTOs de respuesta, sin getter en DTO |
| `indexed: true` | anotación `@Index` en entidad JPA |
| `type: uniqueness` en domain_rule | constraint `@Column(unique = true)` + método `findBy{Field}` en repositorio |
| `relationship: composition` | `@OneToMany(cascade = ALL, orphanRemoval = true)` |

---

## Cómo agregar un nuevo comando CLI

1. Crear `src/commands/{command-name}.js` — función async que recibe opciones y orquesta la generación
2. Crear los generators necesarios en `src/generators/`
3. Crear los templates EJS en `templates/{type}/`
4. Registrar el comando en `bin/dsl-springboot.js` importando el handler y llamando `program.command(...)`

---

## Cuándo notificar al usuario (sin proceder)

Un agente que trabaje en este proyecto debe **detenerse y notificar** al usuario si detecta:

- Un campo en el YAML sin convención definida en este documento
- Un caso de uso con lógica de negocio no trivial **sin** `implementation: scaffold`
- Inconsistencia entre `{bc-name}.yaml` y `{bc-name}-open-api.yaml` (endpoints declarados en OpenAPI sin caso de uso correspondiente en el YAML, o viceversa)
- Cualquier artefacto dentro de `arch/review/` que parezca necesario para la generación

No debe inferir, completar ni resolver estas situaciones por cuenta propia.

---

## Cuándo sugerir ajustes al diseño

Este proyecto no modifica artefactos de diseño. Sin embargo, puede ocurrir que durante la implementación del generador se detecte que el YAML carece de información suficiente para que la generación sea determinística. En ese caso, el agente debe:

1. Identificar el campo o concepto faltante con precisión
2. Argumentar por qué es necesario para el generador (qué decisión ambigua resuelve)
3. Proponer la adición mínima al schema del YAML
4. Notificar al usuario **antes** de proceder

El criterio de evaluación es siempre: ¿la información nueva en el YAML es suficiente para que el generador actúe sin ambigüedad, y el diseño sigue siendo agnóstico a la tecnología?
