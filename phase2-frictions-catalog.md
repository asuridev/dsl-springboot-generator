# Fricciones encontradas en el código generado por la Fase 2 — BC catalog

> Registradas durante la **Fase 3** (implementación de lógica de negocio).
> Bounded context: `catalog` | Fecha: 2026-06-27

Estas fricciones son defectos del generador DSL de Fase 2, **no de la lógica de dominio**.
Ninguna fue corregida durante Fase 3 (están fuera del alcance de esa fase); se documentan
aquí para ser corregidas en el generador o aplicadas como parches manuales antes de pasar
a producción.

---

## D1 — `addProductImage` no emite cabecera `Location`

| Campo | Valor |
|-------|-------|
| Archivo | `catalog/infrastructure/rest/controllers/product/v1/ProductV1Controller.java` |
| Método | `addProductImage(...)` |
| Flujo afectado | FL-PRD-006 Escenario A |

### Descripción

El método fue generado con firma `void` y la anotación `@ResponseStatus(HttpStatus.CREATED)`.
Esto produce un `201 Created` sin cuerpo, pero **sin cabecera `Location`**. El flujo exige:

```
201 Created con header Location: /api/catalog/v1/products/{productId}/images/{imageId}
```

El `imageId` se asigna dentro de `Product.addImage()` (a través de `ProductImage`), de modo
que el handler necesita retornar `ResponseEntity<Void>` y construir el header tras persistir.

### Corrección propuesta

```java
// Antes (generado)
@ResponseStatus(HttpStatus.CREATED)
public void addProductImage(...) { ... }

// Después
public ResponseEntity<Void> addProductImage(...) {
    // ... lógica existente ...
    // obtener el id de la imagen recién añadida (último elemento del producto recargado)
    UUID imageId = /* id asignado */;
    return ResponseEntity
        .created(URI.create("/api/catalog/v1/products/" + productId + "/images/" + imageId))
        .build();
}
```

---

## D1b — Validación de `Content-Type` de imagen devuelve 400 en lugar de 415

| Campo | Valor |
|-------|-------|
| Archivo | `ProductV1Controller.java` — mismo método `addProductImage` |
| Flujo afectado | FL-PRD-006 caso borde |

### Descripción

La validación del tipo MIME del archivo usa `throw new BadRequestException(...)`, que el
`HandlerExceptions` mapea a `400 Bad Request`. El flujo especifica `415 Unsupported Media Type`.

### Corrección propuesta

Lanzar una excepción dedicada que mapee a 415, o usar directamente
`ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)`.

---

## D2 — `UpdateCategoryCommand.name` lleva `@NotEmpty` siendo un campo opcional

| Campo | Valor |
|-------|-------|
| Archivo | `catalog/application/commands/UpdateCategoryCommand.java` |
| Campo afectado | `name` |
| Flujo afectado | FL-CAT-002 caso borde "solo `description` provista" |

### Descripción

```java
// Generado
public record UpdateCategoryCommand(
    String categoryId,
    @Size(max = 120) @NotEmpty String name,   // ← incorrecto
    String description
) implements Command {}
```

`@NotEmpty` falla con `null`, por lo que enviar sólo `description` devuelve `422 Validation Error`
en lugar de `204 No Content`. El YAML declara `name` como `required: false` en UC-CAT-002.

### Corrección propuesta

Eliminar `@NotEmpty` del campo `name`. La unicidad del slug se valida en el handler, no en el bean.

```java
public record UpdateCategoryCommand(
    String categoryId,
    @Size(max = 120) String name,   // sin @NotEmpty
    String description
) implements Command {}
```

---

## D3 — `UpdateProductDetailsCommand.name` misma fricción que D2

| Campo | Valor |
|-------|-------|
| Archivo | `catalog/application/commands/UpdateProductDetailsCommand.java` |
| Campo afectado | `name` |
| Flujo afectado | FL-PRD-002 caso borde "solo `description`" |

### Descripción

```java
// Generado
public record UpdateProductDetailsCommand(
    String productId,
    @Size(max = 150) @NotEmpty String name,   // ← incorrecto
    String description,
    String categoryId
) implements Command {}
```

Idéntico al D2: `name` es `required: false` en UC-PRD-002 pero `@NotEmpty` bloquea `null`.

### Corrección propuesta

```java
public record UpdateProductDetailsCommand(
    String productId,
    @Size(max = 150) String name,   // sin @NotEmpty
    String description,
    String categoryId
) implements Command {}
```

---

## D4 — `validateProductsAndPrices` acepta un solo `productId` en lugar de lista

| Campo | Valor |
|-------|-------|
| Archivo | `ProductV1Controller.java` |
| Método | `validateProductsAndPrices(...)` |
| Flujo afectado | FL-PRD-010 |

### Descripción

```java
// Generado
public List<ProductPriceValidation> validateProductsAndPrices(
    @RequestParam(required = true) String productIds   // ← String, no List
) { ... }
```

Spring mapea `?productIds=p1&productIds=p2` a `List<String>` automáticamente, pero si el
parámetro es `String`, sólo recibe el primero. El resto de los IDs se descarta silenciosamente.

El flujo exige:

```
GET /api/catalog/v1/products/price-validation?productIds=p1&productIds=p2
→ 200 con lista de 2 elementos
```

### Corrección propuesta

```java
public List<ProductPriceValidation> validateProductsAndPrices(
    @RequestParam(required = true) List<String> productIds
) { ... }
```

Y actualizar el comando/query que lo recibe para aceptar la lista completa.

---

## D5 — `AddProductImageCommandHandler` no inyectaba `ProductMediaStoragePort`

| Campo | Valor |
|-------|-------|
| Archivo | `catalog/application/usecases/AddProductImageCommandHandler.java` |
| Flujo afectado | FL-PRD-006 (startup crash sin este fix) |

### Descripción

El handler generado tenía `throw new UnsupportedOperationException("Not implemented yet")`
y **no incluía** `ProductMediaStoragePort` en su constructor, a pesar de que el YAML declara
`storageCalls[]` para UC-PRD-006. La aplicación arrancaba pero el handler hubiera fallado
en tiempo de ejecución al intentar subir el archivo.

Este defecto **sí fue corregido en Fase 3** porque pertenece al wiring del handler (el puerto
es necesario para completar el TODO, no es un cambio de contrato): se añadió el puerto al
constructor y se implementó el patrón "put-first" (subida antes de cargar el agregado).

### Raíz del problema en el generador

El generador no propagó las dependencias de `storageCalls[]` al constructor del handler scaffold.

---

## D6 — `KafkaConfig` no declaraba `KafkaTemplate<String, String>` para `OutboxRelay`

| Campo | Valor |
|-------|-------|
| Archivo | `shared/infrastructure/configurations/kafkaConfig/KafkaConfig.java` |
| Síntoma | `NoSuchBeanDefinitionException` al arrancar — `OutboxRelay` requiere `KafkaTemplate<String, String>` |

### Descripción

`KafkaConfig` sólo registraba `KafkaTemplate<String, Object>`. El `OutboxRelay` generado
requiere `KafkaTemplate<String, String>` (mensajes ya serializados a JSON). Spring no puede
resolver la dependencia por tipo genérico y la aplicación no arranca.

Este defecto **sí fue corregido en Fase 3** (es infraestructura compartida necesaria para
que el outbox funcione):

```java
@Bean
public KafkaTemplate<String, String> outboxKafkaTemplate() {
    Map<String, Object> props = new HashMap<>(kafkaProperties.buildProducerProperties(null));
    props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
    ProducerFactory<String, String> pf = new DefaultKafkaProducerFactory<>(props);
    return new KafkaTemplate<>(pf);
}
```

### Raíz del problema en el generador

El generador no co-generó el bean `KafkaTemplate<String, String>` junto con el `OutboxRelay`.

---

## Resumen de impacto

| ID | Archivo(s) | Corregido en F3 | Pendiente en generador |
|----|------------|-----------------|------------------------|
| D1 | `ProductV1Controller` | No | Sí |
| D1b | `ProductV1Controller` | No | Sí |
| D2 | `UpdateCategoryCommand` | No | Sí |
| D3 | `UpdateProductDetailsCommand` | No | Sí |
| D4 | `ProductV1Controller` | No | Sí |
| D5 | `AddProductImageCommandHandler` | **Sí** | Sí (generador) |
| D6 | `KafkaConfig` | **Sí** | Sí (generador) |

---

## Evaluación en el generador (Fase 2) — 2026-06-27

Validación de cada fricción contra el código real del generador. Principio rector: el generador
**no genera lógica de negocio**, solo scaffolding/wiring determinístico.

| ID | Veredicto | Resolución |
|----|-----------|------------|
| **D2 / D3** | **Bug confirmado** | **Corregido** en el generador |
| **D6** | **Bug confirmado** | **Corregido** en el generador |
| D1b | Válido, pero requiere infra compartida nueva | Diferido (propuesta) |
| D4 | Gap real, multi-superficie y sin test | Diferido (propuesta) |
| D1 | Requiere lógica de dominio o señal de diseño nueva | Diferido (propuesta) |
| D5 | **Ya estaba resuelto** | Sin acción |

### D2 / D3 — corregido

Causa raíz: `@NotEmpty` **no** procede de la anotación de presencia (`buildRequiredAnnotation`,
que sí respeta `required: false`), sino de `mapDslValidations()` cuando la propiedad del agregado
declara `validations: [{ notEmpty: true }]`. Esa anotación se fusionaba en el campo del command
sin tener en cuenta `isOptional`. Corrección: en `buildCommandFields()`
(`src/generators/application-generator.js`) se eliminan las validaciones de **presencia**
(`notEmpty`) de las DSL validations cuando el campo es opcional o path-variable; se conservan las
de **contenido** (`@Size`/`@Pattern`/`@Email`/min/max). Helper `stripPresenceValidations()`.

### D6 — corregido

Causa raíz: `templates/messaging/KafkaConfig.java.ejs` solo declaraba `KafkaTemplate<String,Object>`;
el `OutboxRelay` inyecta `KafkaTemplate<String,String>` (payload JSON ya serializado). Corrección:
se co-genera el bean `KafkaTemplate<String,String>` (con `StringSerializer`) **solo cuando el
outbox está habilitado** (`outboxEnabled` propagado desde `build.js` →
`generateSharedBrokerConfig` → `generateSharedKafkaConfig`).

### D1b — diferido (propuesta)

El guard de Content-Type **sí** se genera (`controller-generator.js`), pero lanza
`BadRequestException` → 400. `HandlerExceptions` ya soporta status dinámico vía `DomainException`
(415 incluido). Propuesta: nueva excepción compartida `UnsupportedMediaTypeException extends
DomainException` (httpStatus 415), capturada por el handler genérico `onDomainException`; el guard
de content-type la lanza en vez de `BadRequestException` (el guard de tamaño se mantiene en
400/413). Requiere generar una clase de infraestructura compartida nueva.

### D4 — diferido (propuesta)

`resolveOApiParamType` (`controller-generator.js`) no tiene rama para `schema.type === 'array'`:
colapsa a `String`, por lo que un query param array recibe solo el primer valor. Gap real, pero la
corrección abarca tres superficies (param del controller + campo del Query record + conversión en
el handler) y **no hay escenario de test** que lo ejerza. Propuesta: soportar arrays →
`List<inner>` end-to-end **siempre que el YAML lo exprese** (OpenAPI `type: array` + `uc.input`
`List[...]`). Si OpenAPI declara array pero `uc.input` es escalar → inconsistencia cross-artefacto
que el validador debe reportar, no inferir.

### D1 — diferido (propuesta)

El `imageId` se asigna **dentro** de `Product.addImage()` (lógica de dominio). Emitir un `Location`
correcto exige lógica (el handler es scaffold con TODO) **o** una señal de diseño que haga el id
del sub-recurso "early-identity" (análogo a `method: create` + `readOnly id defaultValue:
generated`). El YAML declara `method: addImage`, fuera de la convención early-identity actual. El
generador **no debe inferir**: proponer al humano una señal mínima de schema antes de actuar.

### D5 — ya resuelto

`buildStorageWiring()` (`application-generator.js`) fusiona los storage ports en `fkPorts` y los
inyecta en el constructor del handler; ejercido por `test/scenarios/object-storage-minio`. Sin
acción.
