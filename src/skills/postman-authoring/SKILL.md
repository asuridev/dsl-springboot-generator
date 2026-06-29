---
name: postman-authoring
description: >
  Genera las colecciones Postman de un bounded context ya validado: `postman/{bc}-collection.json`
  (una carpeta por flujo `FL-{BC}-{N}`, una request por escenario A/B/C…, más una carpeta CRUD con
  los endpoints triviales del OpenAPI) y `postman/auth-collection.json` (compartido entre BCs, una
  request de token por rol — solo se crea si no existe). La usa el especialista `postman-builder`.
  Úsala cuando necesites emitir/regenerar colecciones Postman reutilizables para revalidar los flujos
  de un BC manualmente.
---

> **Antes de empezar**, lee las **reglas inviolables** y **"cuándo detenerse"** en la skill
> compartida `.agents/skills/orchestration/SKILL.md`.

# Generación de colecciones Postman (Paso G)

El especialista `postman-builder` llega cuando todos los flujos ya están verdes; su salida refleja
exactamente lo que se validó. Escribe los archivos con el tool **Write** dentro de `postman/` en la
raíz del proyecto (lo crea si no existe). **No toca código Java** y no inventa escenarios ni
endpoints que no estén en `flows.md` / OpenAPI; si falta información, lo registra en `blockers[]`.

## Guía de referencia

| Guía (`references/`) | Contenido |
|---|---|
| `postman-collection-guide.md` | Estructura JSON exacta (Postman Collection v2.1.0), plantillas de request, convenciones de nombres de variables, y scripts de test/extracción de token |

## Qué emite

- **`postman/auth-collection.json`** (compartido entre BCs): **si ya existe, NO lo recreces ni
  sobrescribas** — solo notifícalo. Si no existe, una request de token por cada rol/credencial que
  los flujos del BC necesiten; cada una guarda su token en una global
  (`pm.globals.set("token_<rol-kebab>", …)`).
- **`postman/{bc-name}-collection.json`** (se regenera siempre): una carpeta por flujo `FL-{BC}-{N}`
  con una request por escenario (A, B, C…) y su script de test que asserta el `Then`; más una
  carpeta **CRUD** con los UCs **sin** `implementation: scaffold` del OpenAPI. Declara `{{baseUrl}}`
  como variable de colección (default `http://localhost:8080`).
