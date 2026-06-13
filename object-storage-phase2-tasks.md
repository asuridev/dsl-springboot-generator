# Handoff a Fase 2 — Object Storage · Serie de tareas para el generador

> **Audiencia:** el agente/generador de la **Fase 2** (p. ej. `dsl-springboot`).
> **Propósito:** enumerar, como tareas accionables, los cambios introducidos por la
> característica de **object storage** en los artefactos de diseño, para que el generador
> aprenda a consumirlos. Diseño de referencia: [`object-storage.md`](object-storage.md).
>
> **Recordatorio de contrato:** los artefactos declaran **qué/para qué**, nunca **cómo**. La
> tecnología concreta (AWS S3, GCS, Azure Blob, MinIO, filesystem, presigning, CDN) **la elige
> el generador en Fase 2** — no está ni debe estar en el diseño.

---

## 0. Qué cambió (resumen)

Tres constructos nuevos en los artefactos que el generador debe reconocer:

| Constructo | Artefacto | Dónde |
|---|---|---|
| `infrastructure.objectStorage[]` | `system.yaml` | Lista de *stores* lógicos (buckets) |
| `useCases[].storageCalls[]` | `{bc}.yaml` | Interacción de un UC con un store (`put`/`signUrl`/`get`/`delete`) |
| Tipo canónico `StoredObject` | `{bc}.yaml` | `type` de propiedad/param: `{storageKey, url, contentType, sizeBytes}` |

Cambio adicional: un input `type: File` con `source: multipart` **ya puede convivir con partes
escalares** (metadatos del formulario), no solo con el binario.

---

## 1. Qué puede asumir el generador (ya validado en Fase 1)

`dsl validate` garantiza estas invariantes **antes** del handoff. El generador **no** debe
re-validarlas; puede asumirlas:

- **INT-028** — todo `storageCalls[].store` referencia un `objectStorage[].name` existente.
- **INT-029** — `operation: signUrl` solo aparece contra stores con `urlAccess: signed-url`.
- **INT-030** — un `operation: put` viene acompañado de un input `File` (`source: multipart`) *(warn)*.
- **INT-031** — `objectStorage[].ownedBy` es un BC declarado; el acceso cross-BC está marcado *(warn)*.
- **BC-028** — cada `storageCalls[]` tiene `store` y un `operation` ∈ {put, signUrl, get, delete}.

---

## 2. Serie de tareas del generador

> Marca cada tarea al implementarla en el proyecto de Fase 2.

### T1 — Parsear `infrastructure.objectStorage[]`
- [ ] Leer la lista de stores de `system.yaml`. Por cada entrada capturar:
      `name`, `visibility` (`public|private`), `urlAccess` (`public-url|signed-url`),
      `ownedBy`, `signedUrlTtl?`.
- [ ] Si el bloque está ausente → no generar nada de storage (el sistema no almacena binarios).
- **Salida:** un modelo interno de stores indexado por `name`.

### T2 — Generar el **puerto de storage** (abstracción hexagonal)
- [ ] Emitir una interfaz de puerto de salida con las cuatro operaciones del dominio de storage:
      `put(part) → StoredObject`, `signUrl(storageKey) → Url`, `get(storageKey) → BinaryStream`,
      `delete(storageKey) → void`.
- [ ] El puerto es **agnóstico de proveedor**; vive en la capa de aplicación/dominio según
      `infrastructure.deployment.architectureStyle`.
- **Trazabilidad:** `derivedFrom: objectStorage:<name>`.

### T3 — Generar el **adaptador** del store (Fase 2 elige la tecnología)
- [ ] Por cada store, generar un adaptador que implemente el puerto contra el proveedor elegido
      en el build interactivo de Fase 2 (S3/GCS/Azure/MinIO/filesystem).
- [ ] Emitir la **superficie de configuración** por entorno (no del diseño): nombre real del
      bucket, región/endpoint, credenciales (placeholders), base URL/CDN, TTL de firma.
- [ ] Mapear las intenciones a implementación:

| El diseño declara | El adaptador implementa |
|---|---|
| `visibility: public` + `urlAccess: public-url` | bucket público/CDN; `put` devuelve URL estable |
| `visibility: private` + `urlAccess: signed-url` (+ `signedUrlTtl`) | bucket privado; `signUrl` genera presigned URL con expiración |
| `ownedBy: <bc>` | el adaptador vive en el módulo/esquema del BC dueño |

### T4 — Mapear el tipo canónico `StoredObject`
- [ ] Registrar `StoredObject` como VO compuesto `{ storageKey: String, url: Url,
      contentType: String, sizeBytes: Long }` (mismo tratamiento que `Money`).
- [ ] Cuando es `type` de una propiedad de agregado/entidad → generar columnas de persistencia
      para cada campo (naming strategy del proyecto). Para stores `signed-url`, `url` puede ser
      nullable/derivada (se firma en lectura) y normalmente solo se persiste `storageKey`.
- [ ] En DTOs de respuesta exponer `url` (y metadatos) según las reglas de visibilidad de campos.

### T5 — Cablear `storageCalls[]` en el handler del use case
- [ ] Por cada `storageCalls[]` del UC, inyectar el puerto de storage y emitir la llamada
      correspondiente **antes/después** de invocar el `domainMethod`, según la operación:
  - `put` — tomar el input `File` indicado por `input`, subirlo, y **bindear** el `StoredObject`
    resultante al parámetro `bindsTo` del `domainMethod`.
  - `signUrl` — resolver el `storageKey` (del input o del agregado cargado), firmar y bindear la `Url`.
  - `get` — leer el objeto y exponerlo como `BinaryStream` (ver T6).
  - `delete` — resolver el `storageKey` (normalmente del agregado cargado vía `loadAggregate`)
    y borrar; sin valor de retorno.
- [ ] Si el UC es `implementation: scaffold`, dejar el `// TODO` de negocio pero **con la llamada
      de storage ya cableada** (es infraestructura determinística, no lógica de negocio).

### T6 — Controlador HTTP: subida y descarga
- [ ] Para inputs `type: File` (`source: multipart`) → endpoint `multipart/form-data`; la parte
      binaria usa el `partName` declarado; respetar `maxSize` y `contentTypes` como validación.
- [ ] Las **partes escalares** del mismo multipart (metadatos, `source: multipart` no-File) se
      bindean como campos de formulario.
- [ ] Para UCs query con `returns: BinaryStream` alimentados por `operation: get` → respuesta
      binaria con `Content-Disposition` (streaming, no cargar en memoria).
- [ ] Para `public-url` la respuesta JSON incluye `url`; para `signed-url`, el endpoint de lectura
      (`signUrl`) devuelve la `Url` firmada.

### T7 — Las cuatro combinaciones (comportamiento end-to-end)
- [ ] **Subida → URL pública:** `put` sobre store `public-url`; persistir `storageKey` + `url`.
- [ ] **Subida privada → URL firmada:** `put` guarda `storageKey`; un UC de lectura hace `signUrl`.
- [ ] **Descarga (proxy):** `get` → `BinaryStream`; el bucket no se expone al cliente.
- [ ] **Borrado / ciclo de vida:** `delete` (p. ej. al borrar el agregado dueño).

### T8 — Trazabilidad y determinismo
- [ ] Todo artefacto generado (puerto, adaptador, columnas, binding) debe ser rastreable a su
      origen (`objectStorage:<name>` o el `storageCalls[]` del UC).
- [ ] Dado el mismo YAML, el mismo código: sin decisiones implícitas fuera de la config de Fase 2.

---

## 3. Fixture de verificación

Usar `examples/canasta-familiar/` como caso de prueba del generador:

- `system.yaml` → store `product-media` (`public` / `public-url` / `ownedBy: catalog`).
- `catalog.yaml`:
  - `UC-CAT-011 AddProductImage` → `storageCalls: put` + input `File` multipart → URL pública (combinación 1).
  - `UC-CAT-012 RemoveProductImage` → `storageCalls: delete` (combinación 4).
  - Entidad `ProductImage` con `storageKey` + `url`; `domainMethod addImage(image: StoredObject)`.
- `catalog-open-api.yaml` → `addProductImage` en `multipart/form-data`.

El generador debe producir, para este ejemplo: puerto de storage, adaptador para `product-media`,
columnas de `ProductImage`, controlador multipart en `POST /products/{id}/images`, y el borrado
del objeto en `DELETE /products/{id}/images/{imageId}`.

---

## 4. Checklist de cierre del handoff

- [ ] `dsl validate` termina sin errores (las reglas INT-028..031 / BC-028 pasan).
- [ ] El generador reconoce `objectStorage`, `storageCalls` y `StoredObject` sin caer en `Object`/genérico.
- [ ] Las cuatro combinaciones generan código idiomático en la tecnología objetivo.
- [ ] Ninguna decisión de proveedor/región/credencial quedó en el diseño — toda vive en la config de Fase 2.

> Fuentes canónicas: [`object-storage.md`](object-storage.md) ·
> [`../artifact-reference.md`](../artifact-reference.md) (§4.6.6, §4.7.7, §5.8.14, §6.5) ·
> guías de `system.yaml` y `{bc}.yaml`.
