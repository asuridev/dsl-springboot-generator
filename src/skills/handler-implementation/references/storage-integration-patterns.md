# Storage Integration Patterns — Fase 3

Lee este documento cuando el YAML del BC tenga UCs con `storageCalls[]` o cuando el handler
generado contenga una inyección de `{StoreName}StoragePort`.

---

## Cómo detectar que un UC usa storage

**En el YAML (`{bc-name}.yaml`):**
```yaml
useCases:
  - id: UC-CAT-011
    name: AddProductImage
    storageCalls:
      - store: product-media
        operation: put
        input: file
        bindsTo: media
```

**En el handler generado:**
- Inyección de `{StoreName}StoragePort` en el constructor
- Comentarios `// storage {op} → {store-name}` dentro del método `handle()`
- Comentario `// TODO: resolver storageKey desde el agregado cargado` (en delete/signUrl/get)

---

## Lo que Fase 2 ya generó — no lo toques

| Artefacto | Ubicación | Estado |
|-----------|-----------|--------|
| Puerto `{StoreName}StoragePort.java` | `{bc}/application/ports/` | Completo, no modificar |
| Adaptador `{StoreName}MinioStorageAdapter.java` | `{bc}/infrastructure/adapters/storage/` | Completo, no modificar |
| `StorageConfig.java` (beans S3Client + S3Presigner) | `shared/infrastructure/configurations/storageConfig/` | Completo, no modificar |
| Inyección del puerto en el constructor del handler | handler | Generado, no modificar |
| Para `put`: llamada `port.put(command.file())` cableada | handler | Variable `result` disponible |
| Para `delete`/`signUrl`/`get`: `// TODO: resolver storageKey` | handler | **Esto implementas tú** |

---

## El VO canónico `StoredObject`

```java
// shared/domain/valueobject/StoredObject.java
public record StoredObject(
    String storageKey,    // clave del objeto en el bucket (UUID/originalFilename)
    URI url,              // URL pública estable (public-url) o null (signed-url, se resuelve en lectura)
    String contentType,   // MIME type
    Long sizeBytes        // tamaño en bytes
) {}
```

**Cómo viaja al dominio:**
- El adaptador `put()` lo retorna como resultado
- El aggregate root lo recibe como parámetro en el domain method (`bindsTo:` en el YAML indica el nombre del parámetro)
- El aggregate root lo guarda como campo de la entidad hija (o directamente en el aggregate)

**Cómo está persistido en JPA:**
- No como objeto; se expande en 4 columnas planas en la JPA entity:
  `{field}StorageKey (TEXT)`, `{field}Url (TEXT)`, `{field}ContentType (VARCHAR 255)`, `{field}SizeBytes (BIGINT)`
- El mapper JPA reconstruye el `StoredObject` record al llamar `toDomain()`

**Cómo lo accedes desde el dominio cargado:**
```java
// Si la entidad hija expone el StoredObject como campo:
StoredObject stored = image.media();           // getter del campo en la entidad hija
String storageKey   = stored.storageKey();     // la clave que necesitas para delete/signUrl/get

// Si el StoredObject está directamente en el aggregate root:
String storageKey = product.coverImage().storageKey();
```

---

## Patrones por operación

### `put` — subida de archivo

**Lo que Fase 2 generó:**
```java
// storage put → product-media (derived_from: storageCalls[product-media:put])
StoredObject media = productMediaStoragePort.put(command.file());
// TODO: implement business logic
throw new UnsupportedOperationException("Not implemented yet");
```

**Lo que Fase 3 implementa:**
Pasar `media` al domain method del aggregate. El `bindsTo:` en el YAML indica el nombre del parámetro.

```java
// storage put → product-media (derived_from: storageCalls[product-media:put])
StoredObject media = productMediaStoragePort.put(command.file());

// Cargar el aggregate (si la operación es sobre uno existente)
Product product = productRepository.findById(command.productId())
    .orElseThrow(ProductNotFoundError::new);

// Invocar el domain method con el StoredObject
product.addImage(command.imageId(), media);   // "media" = bindsTo en el YAML

// Persistir
productRepository.save(product);
```

**Orden obligatorio:** `put` primero, luego cargar el aggregate, luego domain method, luego save.
Esto garantiza que si el domain method lanza un error de dominio el objeto ya está en el bucket
(trade-off conocido: objeto huérfano transitorio; no añadas lógica compensatoria).

---

### `delete` — borrado de archivo

**Lo que Fase 2 generó:**
```java
// storage delete → product-media (derived_from: storageCalls[product-media:delete])
String storageKey = null; // TODO: resolver storageKey desde el agregado cargado
productMediaStoragePort.delete(storageKey);
// TODO: implement business logic
throw new UnsupportedOperationException("Not implemented yet");
```

**Lo que Fase 3 implementa:**

```java
// 1. Cargar el aggregate
Product product = productRepository.findById(command.productId())
    .orElseThrow(ProductNotFoundError::new);

// 2. Localizar la entidad hija y resolver el storageKey ANTES de borrar
ProductImage image = product.findImage(command.imageId())
    .orElseThrow(ProductImageNotFoundError::new);
String storageKey = image.media().storageKey();

// 3. Borrar del storage (antes del domain method)
productMediaStoragePort.delete(storageKey);

// 4. Invocar el domain method
product.removeImage(command.imageId());

// 5. Persistir
productRepository.save(product);
```

**Invariante crítica:** Si la entidad hija no existe, lanza el error `*_NOT_FOUND` **antes** de
llamar `delete()` en el storage. Nunca borres del bucket un objeto que no está registrado en el dominio.

---

### `signUrl` — URL firmada de acceso temporal (query handler)

Solo aplica a stores con `urlAccess: signed-url` en `system.yaml`. Para `public-url` la URL
estable está en el campo `url` del `StoredObject` persistido; no necesitas generar signed URLs.

**Lo que Fase 2 generó:**
```java
// storage signUrl → product-documents (derived_from: storageCalls[product-documents:signUrl])
// TODO: resolver storageKey desde el agregado cargado
URI signedUrl = productDocumentsStoragePort.signUrl(/* storageKey */);
// TODO: implement business logic
throw new UnsupportedOperationException("Not implemented yet");
```

**Lo que Fase 3 implementa:**
```java
// 1. Cargar la entidad
Product product = productRepository.findById(query.productId())
    .orElseThrow(ProductNotFoundError::new);

// 2. Localizar el campo de storage y extraer el storageKey
ProductDocument doc = product.findDocument(query.documentId())
    .orElseThrow(ProductDocumentNotFoundError::new);
String storageKey = doc.file().storageKey();

// 3. Obtener la signed URL
URI signedUrl = productDocumentsStoragePort.signUrl(storageKey);

// 4. Devolver en el DTO de respuesta
return new DocumentAccessResponseDto(signedUrl.toString(), doc.contentType());
```

---

### `get` — proxy de descarga (devuelve `Resource`)

Aplica cuando el UC tiene un endpoint de descarga que hace proxy del binario (en vez de redirigir).

**Lo que Fase 2 generó:**
```java
// storage get → product-media (derived_from: storageCalls[product-media:get])
// TODO: resolver storageKey desde el agregado cargado
Resource resource = productMediaStoragePort.get(/* storageKey */);
// TODO: implement business logic
throw new UnsupportedOperationException("Not implemented yet");
```

**Lo que Fase 3 implementa:**
```java
// 1. Cargar la entidad
Product product = productRepository.findById(query.productId())
    .orElseThrow(ProductNotFoundError::new);

// 2. Localizar el campo de storage
ProductImage image = product.findImage(query.imageId())
    .orElseThrow(ProductImageNotFoundError::new);
String storageKey  = image.media().storageKey();
String contentType = image.media().contentType();   // para el Content-Type de la respuesta

// 3. Obtener el stream
Resource resource = productMediaStoragePort.get(storageKey);

// 4. Retornar (el controller arma el ResponseEntity)
return new BinaryResourceResult(resource, contentType);
```

> El controller generado ya construye el `ResponseEntity<Resource>` con el `Content-Type` correcto
> usando el campo del DTO. No cambies la firma del handler; solo provee el `Resource` y el
> `contentType` en el objeto de retorno que el flujo especifique.

---

## Auditoría C2 — puntos específicos de storage

Añade estos checks a la auditoría de cada UC con `storageCalls[]`:

- **¿La entidad hija existe antes de delete/signUrl/get?** Si no, el error `*_NOT_FOUND`
  debe lanzarse antes de cualquier llamada al storage port.
- **¿El campo `storageKey` puede ser null en el dominio cargado?** Solo si el campo es
  opcional (`required: false`). Si es requerido y es null, es un dato corrupto: lanza
  `IllegalStateException`, no un error de dominio.
- **¿El flujo especifica qué hacer si el storage falla?** Si no lo hace, deja que la
  `IllegalStateException` del adaptador propague sin envolver. No añadas try-catch extras.
- **¿El store es `signed-url`?** Para `put`: el campo `url` del `StoredObject` retornado
  será `null`; el aggregate lo guarda null y lo persiste null. El signed URL solo se emite
  en el endpoint de lectura vía `signUrl()`. No construyas la URL en el handler de put.
- **¿El store es `public-url`?** La URL estable se construye en el adaptador durante `put()`
  y está en `StoredObject.url()`. No llames `signUrl()` para stores `public-url`.

---

## Validación Paso F para flujos de storage

Para UCs con `storageCalls[]`, el F3 debe incluir verificación en MinIO además de la DB.

**Flujo PUT + `public-url`:**
```bash
# 1. Subir el archivo (multipart)
curl -s -X POST "http://localhost:8080/products/{id}/images" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F "file=@/ruta/imagen.png;type=image/png" | jq .

# 2. Verificar que el objeto existe en MinIO
${RUNTIME} exec ${SYSTEM}-devtools mc ls local/{store-name}

# 3. Verificar que la URL pública es accesible
STORAGE_KEY=$(${RUNTIME} exec ${SYSTEM}-devtools mc ls --recursive local/{store-name} | awk '{print $NF}' | tail -1)
curl -sI "http://localhost:9000/{store-name}/${STORAGE_KEY}" | head -1
# Esperado: HTTP/1.1 200 OK
```

**Flujo PUT + `signed-url`:**
```bash
# Igual que public-url hasta el mc ls, luego:
# La URL pública debe devolver 403 (bucket privado)
curl -sI "http://localhost:9000/{store-name}/${STORAGE_KEY}" | head -1
# Esperado: HTTP/1.1 403 Forbidden

# La URL firmada se obtiene del endpoint de lectura
curl -s "http://localhost:8080/products/{id}/images/{imageId}/url" \
  -H "Authorization: Bearer ${TOKEN}" | jq .url
# La URL resultante debe ser accesible temporalmente
```

**Flujo DELETE:**
```bash
# 1. Verificar que el objeto existe antes de borrar
${RUNTIME} exec ${SYSTEM}-devtools mc ls --recursive local/{store-name}

# 2. Llamar al endpoint de borrado
curl -s -X DELETE "http://localhost:8080/products/{id}/images/{imageId}" \
  -H "Authorization: Bearer ${TOKEN}"

# 3. Verificar que el objeto ya no existe en MinIO
${RUNTIME} exec ${SYSTEM}-devtools mc ls --recursive local/{store-name}
# La clave borrada no debe aparecer

<!-- stack:database=postgresql -->
# 4. Verificar que el registro fue removido de la DB
${RUNTIME} exec ${SYSTEM}-devtools psql -h postgres -U postgres -d {db} \
  -c "SELECT id FROM {bc}.product_images WHERE id = '{imageId}'"
# Debe retornar 0 filas
<!-- /stack -->
```

> Para el comando exacto de verificación en DB según el motor seleccionado (MySQL, SQL Server,
> Oracle), usa la sección correspondiente de `references/infra-validation-guide.md`.

**Si MinIO no responde o el bucket no existe:**
```bash
${COMPOSE} logs --tail=50 minio
${COMPOSE} logs --tail=50 minio-createbuckets
```

> Referencia completa de comandos MinIO: `references/infra-validation-guide.md` sección "MinIO / Object Storage"
