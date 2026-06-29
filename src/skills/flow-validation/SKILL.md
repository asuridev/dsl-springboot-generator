---
name: flow-validation
description: >
  Valida end-to-end TODOS los escenarios (A, B, C…) de **un** flujo `FL-{BC}-{N}` de `{bc}-flows.md`
  contra la aplicación corriendo y la infraestructura real (DB, cache, broker, storage): ejecuta la
  request de cada escenario y verifica el status y los side effects esperados (o su ausencia). Opera
  en dos modos: `validate` (read-only, paralelizable: ni compila, ni reinicia, ni edita) y `fix`
  (serial: el fix-loop completo hasta que el flujo pasa). La usa el especialista `flow-validator`.
  Úsala cuando necesites probar un flujo de un BC end-to-end, validar escenarios de error/borde, o
  confirmar que un UC está realmente "completado" (no solo compilando).
---

> **Antes de empezar**, lee las **reglas inviolables** y **"cuándo detenerse"** en la skill
> compartida `.agents/skills/orchestration/SKILL.md`. Esta skill **no duplica** los comandos CLI ni
> la estructura de los flujos: los toma de las skills hermanas.

# Validación de flujos end-to-end (Paso F)

El especialista `flow-validator` llega después de que `todo-implementer` dejó todos los `// TODO`
implementados y el proyecto compilando, e `infra-provisioner` dejó la infraestructura operativa. Su
trabajo es demostrar, con ejecuciones reales, que **cada escenario** del **flujo que le asignaron**
se comporta como manda `{bc-name}-flows.md`. En `validate` el orquestador hace **fan-out**: lanza un
`flow-validator` por flujo `FL-{BC}-{N}` en paralelo. En `fix` lanza **una sola** invocación con la
**lista de flujos rojos**.

## Dos modos (porque app, Gradle daemon, DB y árbol de código son compartidos)

- **`validate` (read-only, parallel-safe):** te asignan **un** flujo y la app ya está levantada por
  el orquestador. Solo **ejecutas y verificas** (F3): `actuator/health` de cortesía → request de cada
  escenario → verificación de side effects. **No F1 (compilar), no reinicio (F2), no edición (F4).**
  Un escenario rojo se registra en `failures[]` y se devuelve; el orquestador hará la pasada de fix.
  Varios validadores corren en paralelo sobre la misma app/Gradle/árbol — por eso aquí no se muta
  nada.
- **`fix` (serial):** corres en exclusiva y eres el **único** que edita. Te asignan la **lista de
  flujos rojos** y ejecutas el fix-loop completo (F1→F4) sobre **cada flujo, uno a la vez** (revalidas
  uno antes de pasar al siguiente), hasta dejarlos todos verdes.

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

> En modo `validate` haz **solo el paso 3** (tras un `actuator/health` de cortesía) y omite 1, 2 y 4.
> En modo `fix` haz el ciclo completo 1→4 sobre **cada flujo rojo asignado, uno a la vez** (revalida
> uno antes de pasar al siguiente).

1. **F1 — Recompilar** (`./gradlew compileJava`); si falla, corrige antes de seguir. *(solo `fix`)*
2. **F2 — Verificar que la app levanta**: en `fix`, reinicia el contenedor `app` o el proceso
   `bootRun` y comprueba `actuator/health`. En `validate`, **no reinicies** —el orquestador ya dejó
   la app levantada una sola vez—; solo comprueba `actuator/health`.
3. **F3 — Ejecutar tu flujo**: si hay Keycloak, obtén el token primero; itera sobre **cada**
   escenario (A, B, C…) de **tu** flujo traduciendo el `Then` a comandos HTTP + CLI y verificando
   status + side effects (o su ausencia). Los escenarios de error (409/404/403/400) son parte del
   flujo.
4. **F4 — Fix-loop** *(solo `fix`)*: ante un fallo, lee logs, identifica la capa (dominio /
   persistencia / mensajería / respuesta HTTP), corrige el archivo afectado y vuelve a F1, hasta
   `[PASS]` en **todos** los escenarios del flujo en curso; luego pasa al siguiente flujo asignado.
   En modo `validate` no entres aquí: registra el escenario rojo en `failures[]` y devuelve.

Si una falla se debe a una contradicción de diseño (YAML↔flows), a una dependencia cross-BC no
declarada o a un artefacto en `arch/review/` → **no inventes**: regístralo en `blockers[]`. Si tras
un esfuerzo razonable un escenario no queda verde, regístralo en `failures[]`. No cambias firmas ni
contratos generados por Fase 2 para "tapar" un fallo, ni escribes tests de negocio.
