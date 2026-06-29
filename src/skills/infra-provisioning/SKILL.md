---
name: infra-provisioning
description: >
  Levanta y verifica la infraestructura local de un proyecto Spring Boot generado por la Fase 2
  (base de datos, broker, cache, Keycloak, MinIO…) con Docker o Podman, y provee el cheatsheet de
  comandos CLI exactos por servicio para comprobar su estado. La usan el especialista
  `infra-provisioner` (Paso 0b) y el `flow-validator` (para verificar side effects). Úsala cuando
  necesites arrancar el compose, comprobar que un servicio está operativo, o consultar el comando
  CLI exacto de `psql`/`mysql`/`sqlcmd`/`sqlplus`, `kcat`, `redis-cli`, `mc`, o el health de
  Keycloak/RabbitMQ.
---

> **Antes de empezar**, lee las **reglas inviolables** y **"cuándo detenerse"** en la skill
> compartida `.agents/skills/orchestration/SKILL.md`.

# Provisión y verificación de infraestructura

El especialista `infra-provisioner` deja la **infraestructura local operativa** para que el resto de
la Fase 3 pueda validar flujos end-to-end. **No implementa lógica de negocio ni toca `.java`**, y
**no modifica `docker-compose.yml`**: solo **levanta** (`${COMPOSE} up -d`) y **verifica**; si un
servicio no levanta por un problema del compose, reporta el bloqueo, no lo edita.

`status: ready` exige que **todos** los servicios declarados en el compose estén `up`/healthy y que
sus CLI tools respondan.

## Guía de referencia

| Guía (`references/`) | Contenido |
|---|---|
| `infra-validation-guide.md` | Cheatsheet de comandos CLI exactos por servicio: PostgreSQL, MySQL, SQL Server, Oracle, Kafka, RabbitMQ, Redis, Keycloak, MinIO y reinicio/health de la app Spring Boot; patrones del contenedor `devtools` |

## Flujo de verificación (Paso 0b)

1. Detecta el runtime disponible (`podman` → `podman compose`; si no, `docker` → `docker compose`).
2. Ejecuta `./validate-infra.sh`. Si todos los checks son `[PASS]` → `status: ready`.
3. Si algún check `[FAIL]`: el servicio está caído → `${COMPOSE} up -d`, espera ~30 s y reintenta.
4. Si el script falla de forma inesperada (variable no definida, `command not found`, endpoint
   incorrecto): **el bug es del script**, no de la infra → verifica cada servicio manualmente con
   los comandos de `infra-validation-guide.md` antes de levantar nada.
5. Si tras reintentar un servicio sigue caído → `status: failed` con el detalle en `blockers[]`.
