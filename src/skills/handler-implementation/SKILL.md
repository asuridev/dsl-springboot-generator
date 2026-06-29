---
name: handler-implementation
description: >
  Soporte para completar los // TODO de lógica de negocio (handlers, aggregates y domain services)
  de un bounded context generado por la Fase 2. Reúne las guías de detalle del especialista
  `todo-implementer`: cómo leer los artefactos de diseño (`{bc}.yaml` / `{bc}-flows.md`), cuándo y
  cómo extraer domain services, cuándo usar concurrencia con hilos virtuales y cómo integrar el
  almacenamiento de objetos. Úsala al implementar la lógica de negocio de un BC, completar handlers
  con `UnsupportedOperationException`, o decidir si un caso requiere domain service / hilos virtuales
  / storage.
---

> **Antes de empezar**, lee las **reglas inviolables** y **"cuándo detenerse"** en la skill
> compartida `.agents/skills/orchestration/SKILL.md`. Las convenciones de código y arquitectura
> están en `AGENTS.md`. Esta skill provee el detalle de *cómo* implementar; los **Pasos A–E** (el
> proceso) viven en el agente `todo-implementer`.

# Implementación de handlers (lógica de negocio)

El especialista `todo-implementer` completa cada `// TODO: implement business logic` siguiendo
estrictamente el flujo correspondiente (`FL-{BC}-{N}`) de `{bc-name}-flows.md`, con calidad de
experto pero **sin** diseñar dominio, inferir contratos ni cambiar firmas. Su trabajo termina cuando
todos los TODO están implementados y `./gradlew compileJava` queda limpio (la validación end-to-end
es del `flow-validator`).

## Guías de referencia

| Guía (`references/`) | Léela cuando... |
|---|---|
| `bc-artifacts-guide.md` | Necesitas entender la estructura de `{bc-name}-flows.md` o `{bc-name}.yaml` y qué extraer de cada archivo (aggregates, use cases, domain_rules, repositories, errores) y cómo mapear un flujo a su handler |
| `domain-service-patterns.md` | Detectas lógica que cruza más de un aggregate, lógica repetida en varios handlers, o pasos del Given/When/Then que no pertenecen a ningún aggregate |
| `virtual-threads-in-handlers.md` | El handler hace 2+ operaciones de I/O **independientes** que pueden paralelizarse (y evitar los antipatrones de "paralelo disfrazado de secuencial") |
| `storage-integration-patterns.md` | El UC declara `storageCalls[]` (`put` / `delete` / `signUrl` / `get`): patrones de implementación order-dependent y el value object `StoredObject` |

## Recordatorios clave del concern

- **Orden de implementación:** primero los domain services, luego los handlers que los usan; dentro
  de los handlers, el orden de los flujos en `flows.md`.
- **Auditoría de fidelidad al flujo (Paso C2):** antes de editar, audita cada UC contra
  `{bc-name}.yaml` + `{bc-name}-flows.md` (campos opcionales con guardia, casos borde cubiertos por
  excepción/transición idempotente, estado terminal, entidades hijas con `*_NOT_FOUND`, emisión **y
  no-emisión** de eventos, optimistic locking dominio↔JPA). Si la checklist revela una contradicción
  → **bloqueo**.
- **Cross-BC:** una validación que necesita datos de otro BC requiere una `integration:` saliente
  declarada; nunca se inyecta el repositorio del otro BC (ver regla 9 de `orchestration`).
- **No tests de negocio:** pertenecen a otra fase.
