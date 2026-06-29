---
name: flow-validation
description: >
  Valida end-to-end TODOS los escenarios (A, B, C…) de cada flujo `FL-{BC}-{N}` de `{bc}-flows.md`
  contra la aplicación corriendo y la infraestructura real (DB, cache, broker, storage): ejecuta la
  request de cada escenario, verifica el status y los side effects esperados (o su ausencia), y entra
  en un fix-loop hasta que todos pasan. La usa el especialista `flow-validator`. Úsala cuando
  necesites probar los flujos de un BC end-to-end, validar escenarios de error/borde, o confirmar que
  un UC está realmente "completado" (no solo compilando).
---

> **Antes de empezar**, lee las **reglas inviolables** y **"cuándo detenerse"** en la skill
> compartida `.agents/skills/orchestration/SKILL.md`. Esta skill **no duplica** los comandos CLI ni
> la estructura de los flujos: los toma de las skills hermanas.

# Validación de flujos end-to-end (Paso F)

El especialista `flow-validator` llega después de que `todo-implementer` dejó todos los `// TODO`
implementados y el proyecto compilando, e `infra-provisioner` dejó la infraestructura operativa. Su
trabajo es demostrar, con ejecuciones reales, que **cada escenario de cada flujo** se comporta como
manda `{bc-name}-flows.md`.

## Regla de cierre (no negociable)

Un UC **NO está "completado"** hasta que su flujo se ejecute end-to-end con éxito **para TODOS los
escenarios** (A, B, C…): el camino feliz **y** cada escenario de error/borde, con su request real →
side effects verificados en DB/cache/broker/storage (o la **ausencia** de side effects cuando el
flujo lo prohíbe). Compilar y arrancar la app **no** basta.

## Skills hermanas que necesita

| Necesitas… | Skill |
|---|---|
| Los comandos CLI exactos por servicio (`psql`/`kcat`/`redis-cli`/`mc`/health Keycloak…) y el reinicio/health de la app | `.agents/skills/infra-provisioning/references/infra-validation-guide.md` |
| La estructura de `{bc-name}-flows.md` y `{bc-name}.yaml` (cómo leer Given/When/Then, qué side effects esperar) | `.agents/skills/handler-implementation/references/bc-artifacts-guide.md` |
| Validar side effects de almacenamiento de objetos (public-url / signed-url / delete) | `.agents/skills/handler-implementation/references/storage-integration-patterns.md` |

## Ciclo de validación (resumen)

1. **F1 — Recompilar** (`./gradlew compileJava`); si falla, corrige antes de seguir.
2. **F2 — Verificar que la app levanta** (reinicia el contenedor `app` o el proceso `bootRun` y
   comprueba `actuator/health`).
3. **F3 — Ejecutar el flujo de cada UC**: si hay Keycloak, obtén el token primero; itera sobre
   **cada** escenario (A, B, C…) traduciendo el `Then` a comandos HTTP + CLI y verificando status +
   side effects (o su ausencia). Los escenarios de error (409/404/403/400) son parte del flujo.
4. **F4 — Fix-loop**: ante un fallo, lee logs, identifica la capa (dominio / persistencia /
   mensajería / respuesta HTTP), corrige el archivo afectado y vuelve a F1, hasta `[PASS]` en
   **todos** los escenarios.

Si una falla se debe a una contradicción de diseño (YAML↔flows), a una dependencia cross-BC no
declarada o a un artefacto en `arch/review/` → **no inventes**: regístralo en `blockers[]`. Si tras
un esfuerzo razonable un escenario no queda verde, regístralo en `failures[]`. No cambias firmas ni
contratos generados por Fase 2 para "tapar" un fallo, ni escribes tests de negocio.
