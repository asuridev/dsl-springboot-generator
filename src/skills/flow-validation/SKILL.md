---
name: flow-validation
description: >
  Valida end-to-end TODOS los escenarios (A, B, C…) de los flujos `FL-{BC}-{N}` de `{bc}-flows.md`
  contra la aplicación corriendo y la infraestructura real (DB, cache, broker, storage): ejecuta la
  request de cada escenario y verifica el status y los side effects esperados (o su ausencia). Opera
  en dos modos: `validate` (secuencial: recorre los flujos uno a uno reseteando la DB antes de cada
  uno; ni compila ni edita) y `fix` (serial: el fix-loop completo hasta que el flujo pasa). La usa el
  especialista `flow-validator`.
  Úsala cuando necesites probar un flujo de un BC end-to-end, validar escenarios de error/borde, o
  confirmar que un UC está realmente "completado" (no solo compilando).
---

> **Antes de empezar**, lee las **reglas inviolables** y **"cuándo detenerse"** en la skill
> compartida `.agents/skills/orchestration/SKILL.md`. Esta skill **no duplica** los comandos CLI ni
> la estructura de los flujos: los toma de las skills hermanas.

# Validación de flujos end-to-end (Paso F)

El especialista `flow-validator` llega después de que `todo-implementer` dejó todos los `// TODO`
implementados y el proyecto compilando, e `infra-provisioner` dejó la infraestructura operativa. Su
trabajo es demostrar, con ejecuciones reales, que **cada escenario** de **cada flujo que le asignaron**
se comporta como manda `{bc-name}-flows.md`. En `validate` el orquestador lanza **una sola**
invocación con la **lista de todos los flujos** del BC, que el validador recorre secuencialmente
(reset por flujo). En `fix` lanza **una sola** invocación con la **lista de flujos rojos**.

## Dos modos (app, Gradle daemon, DB y árbol de código son compartidos; por eso `validate` no muta código)

- **`validate` (secuencial, no-editante):** te asignan la **lista de todos los flujos** y la app ya
  está levantada por el orquestador. Recorres los flujos **uno a la vez**: antes de cada flujo corres
  `./reset-db.sh`, luego **ejecutas y verificas** (F3): `actuator/health` de cortesía → request de
  cada escenario → verificación de side effects. **No F1 (compilar), no edición (F4).** No reinicias
  la app salvo en H2 (sin `reset-db.sh`: reiniciar recrea el esquema vacío entre flujos). Un escenario
  rojo se registra en `failures[]` y pasas al siguiente flujo; el orquestador hará la pasada de fix.
  El reset por flujo aísla cada flujo de los demás: como corres secuencial, la única data presente al
  ejecutar un flujo es la que su propio escenario A creó (sin colisiones de claves únicas ni lecturas
  del "último global" de otro flujo).
- **`fix` (serial):** corres en exclusiva y eres el **único** que edita. Te asignan la **lista de
  flujos rojos** y ejecutas el fix-loop completo (F1→F4) sobre **cada flujo, uno a la vez** (revalidas
  uno antes de pasar al siguiente), hasta dejarlos todos verdes. Antes de re-ejecutar la secuencia de
  escenarios de un flujo corre `./reset-db.sh` **una vez** (no entre escenarios): tras un intento
  fallido el escenario "create" ya dejó datos, y sin limpiar la DB el re-run recibiría 409 en vez de
  201 y el fix-loop nunca convergería. El reset trunca dominio + outbox/idempotencia y preserva el
  esquema; cada flujo restablece sus propios datos vía su escenario A.

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

> En modo `validate` haz por **cada** flujo el paso 2 (solo reset + health, sin reiniciar salvo H2) y
> el paso 3, y omite 1 (compilar) y 4 (fix-loop). En modo `fix` haz el ciclo completo 1→4 sobre
> **cada flujo rojo asignado, uno a la vez** (revalida uno antes de pasar al siguiente).

1. **F1 — Recompilar** (`./gradlew compileJava`); si falla, corrige antes de seguir. *(solo `fix`)*
2. **F2 — Dejar la app y la DB listas para el flujo**: en `fix`, reinicia el contenedor `app` o el
   proceso `bootRun`, comprueba `actuator/health` y ejecuta `./reset-db.sh` una vez antes de
   re-validar el flujo. En `validate`, **no reinicies** (el orquestador ya dejó la app levantada) pero
   **sí ejecuta `./reset-db.sh` una vez por flujo** antes de sus escenarios y comprueba
   `actuator/health`. El reset deja la DB en el estado limpio que asumen los `Given`; para H2 no
   existe el script y el reinicio recrea el esquema vacío.
3. **F3 — Ejecutar el flujo en curso**: si hay Keycloak, obtén el token primero; itera sobre **cada**
   escenario (A, B, C…) del flujo traduciendo el `Then` a comandos HTTP + CLI y verificando
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

`reset-db.sh` (que corre por flujo en **ambos** modos) asume que **cada flujo es auto-contenido**: su escenario A crea los datos que los
escenarios siguientes verifican. No hay seed de dominio (las tablas las crea Hibernate vacías). Si
el `Given` de un flujo dependiera de datos creados por **otro** flujo (no auto-contenido), tras el
reset esa precondición no se sostiene → regístralo en `blockers[]`; **no** siembres datos a mano
para sortearlo.
