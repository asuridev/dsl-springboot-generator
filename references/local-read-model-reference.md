# Referencia: Patrón Local Read Model (Persistent Projection)

Este documento explica en detalle el patrón de **local read model** tal como lo implementa
el generador. Describe el problema que resuelve, los campos YAML que lo activan, los archivos
que se producen y el flujo completo desde el evento hasta la consulta.

> **Validado contra:** `src/generators/projection-updater-generator.js`,
> `src/generators/messaging-generator.js`, `src/utils/integration-validator.js`,
> `src/utils/bc-yaml-reader.js`,
> `templates/infrastructure/projections/ProjectionJpa.java.ejs`,
> `templates/infrastructure/projections/ProjectionJpaRepository.java.ejs`,
> `templates/infrastructure/projections/ProjectionUpdaterRabbit.java.ejs`,
> `templates/infrastructure/projections/ProjectionUpdaterKafka.java.ejs`,
> `templates/infrastructure/projections/ProjectionPartialUpdaterRabbit.java.ejs`,
> `templates/infrastructure/projections/ProjectionPartialUpdaterKafka.java.ejs`,
> `templates/base/resources/db/migration/V2__projections.sql.ejs`.

---

## Tabla de contenidos

1. [¿Qué problema resuelve?](#1-qué-problema-resuelve)
2. [Concepto: projection normal vs persistent projection](#2-concepto-projection-normal-vs-persistent-projection)
3. [YAML DSL — cómo declarar un local read model](#3-yaml-dsl--cómo-declarar-un-local-read-model)
4. [Reglas de validación (INT-010 / INT-011 / INT-012)](#4-reglas-de-validación-int-010--int-011--int-012)
5. [Archivos generados](#5-archivos-generados)
6. [Ejemplo completo — flujo de punta a punta](#6-ejemplo-completo--flujo-de-punta-a-punta)
7. [Estrategias de upsert](#7-estrategias-de-upsert)
8. [Fuentes adicionales de eventos — `additionalSources`](#8-fuentes-adicionales-de-eventos--additionalsources)
9. [Topología de broker generada automáticamente](#9-topología-de-broker-generada-automáticamente)
10. [Restricciones de tipos](#10-restricciones-de-tipos)
11. [Diferencias RabbitMQ / Kafka](#11-diferencias-rabbitmq--kafka)
12. [Relación con Flyway y el campo `V2__projections.sql`](#12-relación-con-flyway-y-el-campo-v2__projectionssql)
13. [Errores frecuentes](#13-errores-frecuentes)

---

## 1. ¿Qué problema resuelve?

En una arquitectura de microservicios con bounded contexts (BC) separados, un BC que necesita
datos de otro tiene dos opciones en tiempo de query:

| Opción | Problema |
|---|---|
| **Llamada HTTP síncrona al BC origen** | Acoplamiento temporal. Si el BC origen está caído o lento, el BC consumidor falla. Aumenta la latencia de la consulta. |
| **Mantener una copia local de los datos relevantes** | El BC es autónomo. Lee desde su propia base de datos. No hay dependencia en tiempo de query. |

La segunda opción es el **local read model**: una tabla en la base de datos del BC consumidor
que materializa datos del BC productor, mantenida sincronizada mediante eventos de dominio.

### Escenario concreto

El BC `orders` necesita mostrar `nombre` y `precio` del producto al listar líneas de una orden,
pero esos datos viven en el BC `catalog`.

Sin local read model, `orders` tiene que llamar a `catalog` cada vez que se lista una orden.
Con local read model, `orders` escucha el evento `ProductActivated` que publica `catalog` y
mantiene una tabla `proj_local_product_view` en su propia base de datos:

```
catalog BC                        orders BC
──────────────────────────────    ─────────────────────────────────────────────
Product activado                  Listener recibe ProductActivated
  → publica ProductActivated  →   → upsert en proj_local_product_view
                                  → query de orden: JOIN local, sin llamada HTTP
```

---

## 2. Concepto: projection normal vs persistent projection

El DSL distingue dos tipos de objetos llamados `projections`:

| Tipo | `persistent` | Qué genera | Para qué sirve |
|---|---|---|---|
| **Projection (record Java)** | ausente o `false` | Un `record` Java en `application/dtos/` | Tipo de retorno de queries. Shape de lectura optimizado. Sin tabla. |
| **Persistent projection (local read model)** | `true` | Entidad JPA + repositorio + listener de eventos + SQL migration | Tabla materializada actualizada por eventos del broker. |

Solo las proyecciones con `persistent: true` activan el generador de local read models
(`projection-updater-generator.js`).

---

## 3. YAML DSL — cómo declarar un local read model

La sección `projections[]` en `{bc}.yaml` acepta el flag `persistent: true` junto con
los campos adicionales obligatorios que se describen a continuación.

### Schema completo

```yaml
projections:

  - name: LocalProductView                    # PascalCase — nombre de la clase Java
    description: >                            # opcional — referencia
      Local read model maintained by orders. Materialized from catalog.ProductActivated.
      Avoids synchronous calls to catalog at order listing time.
    persistent: true                          # ← activa el generador de local read model
    source:
      kind: event                             # obligatorio — único valor soportado
      event: ProductActivated                 # PascalCase — nombre del evento publicado por 'from'
      from: catalog                           # kebab-case — BC que publica el evento
    keyBy: productId                          # nombre de la propiedad que actúa como PK de la tabla
    tableName: proj_local_product_view        # opcional; default: proj_{snake_case(name)}
    upsertStrategy: lastWriteWins             # lastWriteWins (default) | versionGuarded
    properties:
      - name: productId                       # DEBE ser el mismo valor que keyBy
        type: Uuid
        required: true
      - name: name
        type: String(200)
        required: true
      - name: status
        type: String(50)                      # solo tipos escalares canónicos — no VOs, no agregados
        required: true
      - name: price
        type: Decimal
        precision: 19
        scale: 4
        required: true
    additionalSources:                        # opcional — eventos adicionales que actualizan campos
      - kind: event                           # obligatorio — único valor soportado
        event: ProductPriceChanged            # PascalCase — evento publicado por 'from'
        from: catalog                         # kebab-case — BC que publica el evento
        updatesFields:                        # campos de properties[] que actualiza este evento
          - price                             # el campo keyBy NUNCA puede aparecer aquí
```

### Propiedades obligatorias y opcionales

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | PascalCase | ✅ | Nombre de la clase Java. Genera `{Name}Jpa.java`, `{Name}JpaRepository.java`, `{Name}ProjectionUpdater.java`. |
| `persistent` | `true` | ✅ | Activa el generador de local read model. Sin este flag, se genera solo el `record` Java. |
| `source.kind` | `event` | ✅ | El único valor soportado es `event`. |
| `source.event` | PascalCase | ✅ | Nombre del evento declarado en `domainEvents.published[]` del BC `source.from`. Validación INT-010. |
| `source.from` | kebab-case | ✅ | BC que publica el evento. Debe existir en `arch/`. Validación INT-010. |
| `keyBy` | camelCase | ✅ | Nombre de la propiedad en `properties[]` que será la Primary Key de la tabla. Validación INT-011. |
| `properties` | lista | ✅ | Campos de la tabla materializada. Todos deben ser tipos escalares canónicos. Los campos `Decimal` requieren `precision` y `scale`. |
| `tableName` | snake_case | no | Nombre de la tabla SQL. Default: `proj_{snake_case(name)}`. |
| `upsertStrategy` | string | no | `lastWriteWins` (default) o `versionGuarded`. Ver §7. |
| `eventVersionField` | camelCase | no (requerido si `versionGuarded`) | Nombre del campo en `properties[]` que contiene la versión del evento. Solo aplica con `upsertStrategy: versionGuarded`. |
| `description` | texto | no | Solo referencia. Se emite en el Javadoc de la clase JPA. |
| `additionalSources` | lista | no | Eventos adicionales de otros (o el mismo) BC que actualizan un subconjunto de campos sin insertar filas nuevas. Ver §8. |

---

## 4. Reglas de validación (INT-010 / INT-011 / INT-012)

El validador de coherencia (`integration-validator.js`) verifica las persistent projections
durante el build, antes de generar código.

### INT-010 — Fuente de evento válida

```
error  INT-010  orders.yaml#/projections[0]
Persistent projection "LocalProductView" must declare
source: { kind: event, event: <Name>, from: <bc> }.
```

Condiciones que activan INT-010:
- `source` ausente o sin `kind: event`
- `source.event` ausente o vacío
- `source.from` ausente o referencia a un BC que no existe en `arch/`
- El evento `source.event` no está declarado en `domainEvents.published[]` del BC `source.from`

### INT-011 — `keyBy` válido

```
error  INT-011  orders.yaml#/projections[0]
Persistent projection "LocalProductView" keyBy="productId"
is not declared in properties[].
```

Condiciones que activan INT-011:
- `keyBy` ausente
- El valor de `keyBy` no corresponde a ningún `name` en `properties[]`

### INT-012 — Fuentes adicionales válidas

```
error  INT-012  orders.yaml#/projections[0]/additionalSources[0]/event
Persistent projection "LocalProductView" additionalSources[0] sources event
"ProductPriceChanged" but catalog.yaml does not publish it.
```

Una validación INT-012 se emite por cada entrada de `additionalSources[]` que referencie:
- Un BC (`from`) que no exista en `arch/`
- Un evento que no esté declarado en `domainEvents.published[]` del BC `from`

Las validaciones estructurales de `additionalSources` (campos obligatorios, `updatesFields`
no vacío, campos inexistentes en `properties[]`, `keyBy` incluido en `updatesFields`) se
comprueban en `bc-yaml-reader.js` antes de llegar al validador de integración.

---

## 5. Archivos generados

Por cada `projection` con `persistent: true`, el generador produce **tres archivos Java** como
mínimo. Si la proyección declara `additionalSources`, se genera **un archivo adicional por
cada entrada** de ese array. Además, una vez por proyecto si hay al menos una persistent
projection, produce **un archivo SQL**.

### 5.1 `{Name}Jpa.java` — entidad JPA

**Ruta:** `src/main/java/{pkg}/{bc}/infrastructure/persistence/projections/{Name}Jpa.java`

Entidad JPA que representa una fila de la tabla materializada.
Usa Lombok (`@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder`).
Incluye siempre una columna `last_updated_at` (tipo `Instant`) que el updater rellena en cada upsert.

**Reglas del generador para la columna clave (`keyBy`):**
- Anotada con `@Id`
- `nullable = false, updatable = false` — la PK nunca cambia una vez insertada
- No tiene `@GeneratedValue` — el valor viene del evento

**Reglas para las columnas no-clave:**
- Cada propiedad genera una anotación `@Column(name = "{snake_case}", ...)` con los atributos
  derivados del tipo y los campos `precision`, `scale`, `required` declarados en el YAML
- Tipos `String` / `Text` / `Url` → `columnDefinition = "TEXT"`
- Tipo `Email` → `length = 254`
- Tipo `String(n)` → `length = n`
- Tipo `Decimal` → `precision` y `scale` del YAML (defaults: 19 y 4)
- `required: true` → `nullable = false`

### 5.2 `{Name}JpaRepository.java` — repositorio Spring Data

**Ruta:** `src/main/java/{pkg}/{bc}/infrastructure/persistence/projections/{Name}JpaRepository.java`

Interfaz Spring Data JPA que extiende `JpaRepository<{Name}Jpa, {KeyJavaType}>`.
No tiene métodos adicionales — el updater solo necesita `findById` y `save`,
ambos provistos por `JpaRepository`.

### 5.3 `{Name}ProjectionUpdater.java` — listener principal del broker

**Ruta:** `src/main/java/{pkg}/{bc}/infrastructure/projectionUpdaters/{Name}ProjectionUpdater.java`

Componente Spring que escucha el evento de `source.event` y hace el **upsert completo** de la
fila: inserta si no existe, actualiza todos los campos si ya existe.

El template usado depende del broker declarado en `system.yaml`:
- `broker: rabbitmq` → `ProjectionUpdaterRabbit.java.ejs`
- `broker: kafka` → `ProjectionUpdaterKafka.java.ejs`

El nombre del bean Spring es `"{bc}.{Name}ProjectionUpdater"` — calificado con el nombre del BC
para evitar colisiones cuando múltiples BCs del mismo servicio declaran proyecciones.

**Lógica de upsert generada (ambos brokers):**

```
1. Deserializar EventEnvelope<Map<String, Object>> del mensaje
2. Extraer el campo keyBy del data map
3. Si el keyBy es null → ack + discard (log warn)
4. findById(key)
5. [si versionGuarded] comparar versión → si stale, ack + skip
6. row = existing.orElseGet(Entity::new)   ← inserta si no existe
7. Setear todos los campos (incluido keyBy y lastUpdatedAt = Instant.now())
8. repository.save(row)
9. Ack del mensaje
```

### 5.4 `{Name}On{Event}ProjectionUpdater.java` — listener parcial (por cada `additionalSources`)

**Ruta:** `src/main/java/{pkg}/{bc}/infrastructure/projectionUpdaters/{Name}On{Event}ProjectionUpdater.java`

Se genera **uno por cada entrada** en `additionalSources[]`. A diferencia del listener principal,
este updater es **solo de actualización parcial**: nunca inserta filas nuevas.

El template usado sigue el mismo criterio de broker:
- `broker: rabbitmq` → `ProjectionPartialUpdaterRabbit.java.ejs`
- `broker: kafka` → `ProjectionPartialUpdaterKafka.java.ejs`

El nombre del bean Spring es `"{bc}.{Name}On{Event}ProjectionUpdater"`.

**Lógica generada (ambos brokers):**

```
1. Deserializar EventEnvelope<Map<String, Object>> del mensaje
2. Extraer el campo keyBy del data map
3. Si el keyBy es null → ack + discard (log warn)
4. findById(key)
5. Si la fila NO existe → ack + discard (log debug) ← diferencia clave con el updater principal
6. [si versionGuarded] comparar versión → si stale, ack + skip
7. row = existing.get()                    ← NUNCA orElseGet — solo actualiza
8. Setear SOLO los campos de updatesFields + lastUpdatedAt = Instant.now()
9. repository.save(row)
10. Ack del mensaje
```

**¿Por qué descartar si la fila no existe?**

El listener parcial reacciona a un evento que solo actualiza campos derivados (ej.
`ProductPriceChanged` actualiza el precio). Si el evento de creación (`ProductActivated`,
gestionado por el listener principal) aún no llegó o fue rechazado, la fila no existe.
Insertar en ese caso dejaría la fila con campos obligatorios nulos. El evento de precio
se descarta y se loguea en `DEBUG` para no saturar los logs en producción.

### 5.5 `V2__projections.sql` — migración Flyway

**Ruta:** `src/main/resources/db/migration/V2__projections.sql`

Generado **una sola vez** para el proyecto entero, con el DDL de **todas** las tablas de
persistent projections de todos los BCs. Si no hay ninguna persistent projection, este
archivo no se genera. Los `additionalSources` no añaden tablas adicionales — comparten la
misma tabla que el `source` principal.

**Convención de nombres de tabla:**

| Declarado en YAML | Nombre de tabla generado |
|---|---|
| `tableName: proj_local_product_view` | `proj_local_product_view` (literal) |
| `tableName` ausente + `name: LocalProductView` | `proj_local_product_view` (derivado por snake_case) |
| `tableName` ausente + `name: ProductSummaryReadModel` | `proj_product_summary_read_model` |

---

## 6. Ejemplo completo — flujo de punta a punta

### Contexto del ejemplo

- BC `catalog` publica el evento `ProductActivated`
- BC `orders` mantiene un local read model `LocalProductView` con los datos del producto que
  necesita al listar líneas de órdenes
- Broker: RabbitMQ
- Package base: `com.example`

### 6.1 YAML del BC productor — `arch/catalog/catalog.yaml` (fragmento)

```yaml
bc: catalog

domainEvents:
  published:
    - name: ProductActivated
      scope: integration
      channel: catalog.product.activated
      payload:
        - name: productId
          type: Uuid
          source: aggregate
          field: id
        - name: name
          type: String(200)
          source: aggregate
          field: name
        - name: status
          type: String(50)
          source: aggregate
          field: status
        - name: price
          type: Decimal
          source: aggregate
          field: price
```

### 6.2 YAML del BC consumidor — `arch/orders/orders.yaml` (fragmento)

```yaml
bc: orders

projections:
  - name: LocalProductView
    description: >
      Local read model maintained by orders.
      Materialized from catalog.ProductActivated.
      Avoids synchronous calls to catalog at order listing time.
    persistent: true
    source:
      kind: event
      event: ProductActivated
      from: catalog
    keyBy: productId
    tableName: proj_local_product_view
    upsertStrategy: lastWriteWins
    properties:
      - name: productId
        type: Uuid
        required: true
      - name: name
        type: String(200)
        required: true
      - name: status
        type: String(50)
        required: true
      - name: price
        type: Decimal
        precision: 19
        scale: 4
        required: true
```

### 6.3 Archivos Java generados

#### `LocalProductViewJpa.java`

```java
package com.example.orders.infrastructure.persistence.projections;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;
import java.util.UUID;

/**
 * LocalProductViewJpa — persistent local read model.
 * derived_from: bc.orders.projections[LocalProductView] (persistent: true)
 * source: catalog.domainEvents.published[ProductActivated]
 * key: productId
 * upsert: lastWriteWins
 *
 * Local read model maintained by orders.
 * Materialized from catalog.ProductActivated.
 * Avoids synchronous calls to catalog at order listing time.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "proj_local_product_view")
public class LocalProductViewJpa {

    @Id
    @Column(name = "product_id", nullable = false, updatable = false)
    private UUID productId;

    @Column(name = "name", length = 200, nullable = false)
    private String name;

    @Column(name = "status", length = 50, nullable = false)
    private String status;

    @Column(name = "price", precision = 19, scale = 4, nullable = false)
    private BigDecimal price;

    @Column(name = "last_updated_at", nullable = false)
    private Instant lastUpdatedAt;
}
```

#### `LocalProductViewJpaRepository.java`

```java
package com.example.orders.infrastructure.persistence.projections;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.UUID;

/**
 * Spring Data repository for LocalProductViewJpa.
 * derived_from: bc.orders.projections[LocalProductView] (persistent: true)
 */
@Repository
public interface LocalProductViewJpaRepository extends JpaRepository<LocalProductViewJpa, UUID> {
}
```

#### `LocalProductViewProjectionUpdater.java` (broker: RabbitMQ)

```java
package com.example.orders.infrastructure.projectionUpdaters;

import com.example.orders.infrastructure.persistence.projections.LocalProductViewJpa;
import com.example.orders.infrastructure.persistence.projections.LocalProductViewJpaRepository;
import com.example.shared.infrastructure.eventEnvelope.EventEnvelope;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Persistent projection updater for LocalProductView.
 * Subscribes to catalog.product-activated and upserts the local read model.
 * derived_from: bc.orders.projections[LocalProductView] (persistent: true)
 * upsertStrategy: lastWriteWins
 */
@Component("orders.LocalProductViewProjectionUpdater")
public class LocalProductViewProjectionUpdater {

    private static final Logger log = LoggerFactory.getLogger(LocalProductViewProjectionUpdater.class);

    private final LocalProductViewJpaRepository repository;
    private final ObjectMapper objectMapper;

    public LocalProductViewProjectionUpdater(LocalProductViewJpaRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = "${queues.orders-projection-local-product-view-product-activated}")
    @Transactional
    public void handle(Message message, Channel channel) throws IOException {
        long deliveryTag = message.getMessageProperties().getDeliveryTag();

        EventEnvelope<Map<String, Object>> event;
        try {
            event = objectMapper.readValue(
                    message.getBody(),
                    new TypeReference<EventEnvelope<Map<String, Object>>>() {});
        } catch (JsonProcessingException e) {
            log.error("Fatal deserialization error in projection updater — sending to DLQ: {}", e.getMessage());
            channel.basicNack(deliveryTag, false, false);
            return;
        }

        try {
            Map<String, Object> data = event.data();
            UUID key = objectMapper.convertValue(data.get("productId"), UUID.class);
            if (key == null) {
                log.warn("Projection event for LocalProductView missing keyBy field productId — discarding");
                channel.basicAck(deliveryTag, false);
                return;
            }

            Optional<LocalProductViewJpa> existing = repository.findById(key);

            LocalProductViewJpa row = existing.orElseGet(LocalProductViewJpa::new);
            row.setProductId(key);
            row.setName(objectMapper.convertValue(data.get("name"), String.class));
            row.setStatus(objectMapper.convertValue(data.get("status"), String.class));
            row.setPrice(objectMapper.convertValue(data.get("price"), BigDecimal.class));
            row.setLastUpdatedAt(Instant.now());
            repository.save(row);

            channel.basicAck(deliveryTag, false);
        } catch (RuntimeException e) {
            log.warn("Projection updater error — will retry. queue={}, error={}",
                    message.getMessageProperties().getConsumerQueue(), e.getMessage(), e);
            throw e;
        }
    }
}
```

#### `V2__projections.sql`

```sql
-- derived_from: bc.<bc>.projections[*] (persistent: true)
-- Persistent local read models materialized from upstream events.
-- Auto-generated by dsl-springboot-generator.

-- ── orders.LocalProductView ───────────────────────────────────────
-- source: catalog.ProductActivated  upsert: lastWriteWins
CREATE TABLE IF NOT EXISTS proj_local_product_view (
    product_id UUID NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    status VARCHAR(50) NOT NULL,
    price NUMERIC(19, 4) NOT NULL,
    last_updated_at TIMESTAMP NOT NULL
);
```

### 6.4 Clave de cola en `rabbitmq.yaml`

El generador añade automáticamente la entrada correspondiente en el bloque `queues` del
archivo de parámetros del broker:

```yaml
# src/main/resources/parameters/local/rabbitmq.yaml
queues:
  # ... otras colas del sistema ...
  orders-projection-local-product-view-product-activated: orders.orders-projection-local-product-view-product-activated
```

La clave sigue la convención (calculada en `projection-updater-generator.js` función `projectionQueueKey`):

```
{bcName}-projection-{projKebab}-{eventKebab}
```

Para el ejemplo:
- `bcName` = `orders`
- `projKebab` = `local-product-view`
- `eventKebab` = `product-activated`
- Resultado: `orders-projection-local-product-view-product-activated`

La clave de cola es **distinta** de la clave de los eventos consumidos por `domainEvents.consumed[]`.
Esto permite que un BC tenga tanto un listener de dominio como un listener de proyección para
el mismo evento, sin conflicto.

### 6.5 Flujo completo de datos

```
1. CATALOG BC
   Product.activate() → raise(ProductActivatedEvent)
   → RepositoryImpl.save() → pullDomainEvents() → eventPublisher.publishEvent()
   → KafkaMessageBroker / RabbitMessageBroker publica al exchange "catalog.events"
       con routing-key "product.activated"

2. BROKER
   El mensaje se enruta desde "catalog.events" (exchange)
   a la cola "orders.orders-projection-local-product-view-product-activated"
   (queue declarada por el generador en OrdersRabbitMQConfig.java — ver §9)

3. ORDERS BC — ProjectionUpdater
   LocalProductViewProjectionUpdater.handle() recibe el Message
   → deserializa EventEnvelope<Map<String, Object>>
   → extrae key = data.get("productId") → UUID
   → repository.findById(key) → Optional (insert o update)
   → setea name, status, price, lastUpdatedAt
   → repository.save(row)
   → channel.basicAck(deliveryTag, false)

4. ORDERS BC — Query en tiempo de servicio
   ListOrderLinesQueryHandler necesita nombre y precio del producto:
   → localProductViewJpaRepository.findById(order.getProductId())
   → sin llamada HTTP a catalog
   → respuesta en <1ms desde la misma base de datos
```

---

## 7. Estrategias de upsert

El campo `upsertStrategy` controla qué pasa cuando llega un evento para una fila que ya existe.

### `lastWriteWins` (default)

El mensaje más reciente en el tiempo de procesamiento siempre sobreescribe la fila existente.
No hay guardia de versión — si llegan dos mensajes desordenados, el último procesado gana.

```yaml
upsertStrategy: lastWriteWins
```

**Java generado en el updater:**

```java
// Sin bloque de verificación de versión — siempre upserta
LocalProductViewJpa row = existing.orElseGet(LocalProductViewJpa::new);
row.setProductId(key);
row.setName(...);
row.setLastUpdatedAt(Instant.now());
repository.save(row);
```

**Cuándo usar:** cuando el broker garantiza orden por entidad (Kafka con partición por
`productId`), o cuando los datos del read model son tolerantes a actualizaciones desordenadas.

### `versionGuarded`

El updater compara la versión del evento entrante con la versión almacenada. Si el evento
es más antiguo o igual, se descarta silenciosamente.

```yaml
upsertStrategy: versionGuarded
eventVersionField: version     # nombre de la propiedad en properties[] que contiene la versión
properties:
  - name: productId
    type: Uuid
    required: true
  - name: version
    type: Long                 # tipo numérico comparable — Long o Integer
    required: true
  - name: name
    type: String(200)
    required: true
```

El campo `eventVersionField` puede omitirse si existe una propiedad llamada exactamente `version`
en `properties[]` — el generador la detecta automáticamente. Si se usa un nombre distinto
(por ejemplo `sequenceNumber`), declarar `eventVersionField: sequenceNumber`.

**Java generado en el updater (bloque de guardia):**

```java
Long incomingVersion = objectMapper.convertValue(data.get("version"), Long.class);
if (existing.isPresent() && incomingVersion != null && existing.get().getVersion() != null
        && incomingVersion.compareTo(existing.get().getVersion()) <= 0) {
    log.debug("Skipping stale projection update for LocalProductView key={} (incoming v{} <= stored v{})",
            key, incomingVersion, existing.get().getVersion());
    channel.basicAck(deliveryTag, false);
    return;
}
```

El método `compareTo` se aplica sobre el tipo de la versión (`Long`, `Integer`).
El generador infiere el tipo Java desde la propiedad declarada en `properties[]`.

**Cuándo usar:** cuando el broker puede entregar mensajes desordenados (RabbitMQ sin garantía
de orden, Kafka con múltiples particiones sin clave fija). El evento publicado debe incluir
un número de versión o secuencia monótonamente creciente.

---

## 8. Fuentes adicionales de eventos — `additionalSources`

### El problema que resuelve

Una projection puede necesitar actualizarse desde **más de un evento**. Ejemplo: el BC
`orders` mantiene `LocalProductView` con datos del producto. El evento `ProductActivated`
crea la fila con nombre y precio inicial. Más tarde, cuando el precio cambia, el BC `catalog`
publica `ProductPriceChanged` con el nuevo precio.

Sin `additionalSources`, la única solución era duplicar la proyección con distinto nombre,
lo que crea dos entidades JPA sobre la misma tabla y provoca `DuplicateMappingException` en
tiempo de ejecución.

### Cómo declararlo

```yaml
projections:
  - name: LocalProductView
    persistent: true
    source:
      kind: event
      event: ProductActivated      # fuente principal — inserta Y actualiza
      from: catalog
    keyBy: productId
    properties:
      - name: productId
        type: Uuid
        required: true
      - name: productName
        type: String
        required: true
      - name: price
        type: Decimal
        precision: 10
        scale: 2
        required: true
    additionalSources:
      - kind: event
        event: ProductPriceChanged  # fuente adicional — solo actualiza
        from: catalog
        updatesFields:
          - price                   # campos de properties[] que este evento actualiza
```

### Campos de `additionalSources[]`

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `kind` | `event` | ✅ | Único valor soportado. |
| `event` | PascalCase | ✅ | Nombre del evento. Debe estar en `domainEvents.published[]` del BC `from`. Validación INT-012. |
| `from` | kebab-case | ✅ | BC que publica el evento. Validación INT-012. |
| `updatesFields` | lista de strings | ✅ | Nombres de propiedades de `properties[]` que este evento actualiza. No puede estar vacío. El campo `keyBy` no puede aparecer aquí. |

### Restricciones

- `additionalSources` solo es válido en proyecciones con `persistent: true`. Declararlo en
  una projection sin `persistent: true` produce un error de validación en `bc-yaml-reader.js`.
- El campo `keyBy` **no puede** aparecer en `updatesFields` de ninguna fuente adicional. La PK
  de la tabla nunca se actualiza — su valor viene exclusivamente del evento de `source` principal.
- Cada campo listado en `updatesFields` debe estar declarado en `properties[]`.
- **El evento de cada `additionalSources` entry DEBE incluir el campo `keyBy` en su `payload[]`
  en el BC productor.** El partial updater lo necesita para hacer `findById` y localizar la fila.
  Si el campo está ausente del payload, el updater descarta el evento silenciosamente con un
  log `WARN` (`missing keyBy field — discarding`) y la actualización se pierde sin error de build.
- Los eventos de `additionalSources` **no** necesitan estar en `domainEvents.consumed[]` del
  BC consumidor. El validador INT-002 acepta que un evento esté cubierto por una persistent
  projection (fuente principal o adicional) como alternativa a `domainEvents.consumed[]`.

### Archivos generados por `additionalSources`

Por cada entrada de `additionalSources[]` se genera **un archivo Java adicional**:

```
{Name}On{Event}ProjectionUpdater.java
```

Por ejemplo, para la proyección del ejemplo anterior:

```
orders/infrastructure/projectionUpdaters/
  LocalProductViewProjectionUpdater.java              ← fuente principal (ProductActivated)
  LocalProductViewOnProductPriceChangedProjectionUpdater.java  ← fuente adicional
```

La **tabla SQL** (`V2__projections.sql`) **no cambia** — `additionalSources` escribe en la
misma tabla que el updater principal. Solo se añaden entradas al broker (una cola/topic por
fuente adicional).

### `upsertStrategy` en fuentes adicionales

El updater parcial hereda la `upsertStrategy` de la proyección padre:

- **`lastWriteWins`**: el updater parcial siempre escribe los campos `updatesFields` si la
  fila existe.
- **`versionGuarded`**: el updater parcial aplica la misma guardia de versión que el updater
  principal. Si el evento entrante tiene una versión `<=` a la almacenada, se descarta.

---

## 9. Topología de broker generada automáticamente

Las persistent projections registran su propia entrada en la topología del broker, **independiente**
de `domainEvents.consumed[]`. Esto permite que un BC consuma el mismo evento con dos propósitos
distintos (procesar lógica de dominio Y actualizar un read model) sin conflicto de colas.

Cada entrada de `additionalSources[]` genera su propia cola/topic adicional, siguiendo la
misma convención que la fuente principal.

### RabbitMQ

Fuente: `buildRabbitMQTopology` en `messaging-generator.js`.

Por cada persistent projection (fuente principal **y** por cada entrada de `additionalSources`):

| Sección | Clave | Valor |
|---|---|---|
| `queues` | `{bc}-projection-{projKebab}-{eventKebab}` | `{bc}.{key}` |
| `routing-keys` | misma clave | `{eventKebab}` en dot-notation |
| `exchanges` | `{from}` | `{from}.events` (si no existe ya) |

Para el ejemplo con `additionalSources`:

```yaml
queues:
  orders-projection-local-product-view-product-activated: orders.orders-projection-local-product-view-product-activated
  orders-projection-local-product-view-product-price-changed: orders.orders-projection-local-product-view-product-price-changed

routing-keys:
  orders-projection-local-product-view-product-activated: product.activated
  orders-projection-local-product-view-product-price-changed: product.price.changed
```

Ambas queues se enlazan al exchange `catalog.events`, ya que los dos eventos vienen del mismo BC.

### Kafka

Fuente: `buildKafkaTopology` en `messaging-generator.js`.

Por cada fuente (principal y adicionales):

| Clave | Valor |
|---|---|
| `{bc}-projection-{projKebab}-{eventKebab}` | `{from}.{eventKebab}` |

```yaml
topics:
  orders-projection-local-product-view-product-activated: catalog.product-activated
  orders-projection-local-product-view-product-price-changed: catalog.product-price-changed
```

El `@KafkaListener` del updater parcial usa groupId diferenciado:

```java
@KafkaListener(
    topics = "${topics.orders-projection-local-product-view-product-price-changed}",
    groupId = "${spring.application.name}-LocalProductViewOnProductPriceChanged"
)
```

---

## 10. Restricciones de tipos

Las persistent projections tienen restricciones de tipos más estrictas que las projections
normales (records Java), porque sus propiedades se mapean a columnas de una tabla SQL.

### Tipos escalares canónicos soportados

| Tipo DSL | Java | SQL (PostgreSQL) |
|---|---|---|
| `Uuid` | `UUID` | `UUID` |
| `String` | `String` | `TEXT` |
| `String(n)` | `String` | `VARCHAR(n)` |
| `Text` | `String` | `TEXT` |
| `Email` | `String` | `VARCHAR(254)` |
| `Url` | `String` | `TEXT` |
| `Integer` | `Integer` | `INTEGER` |
| `Long` | `Long` | `BIGINT` |
| `Decimal` | `BigDecimal` | `NUMERIC(precision, scale)` |
| `Boolean` | `Boolean` | `BOOLEAN` |
| `Date` | `LocalDate` | `DATE` |
| `DateTime` | `Instant` | `TIMESTAMP` |

### Tipos NO soportados en persistent projections

El generador lanza un error inmediato si se declara cualquiera de estos tipos en las
propiedades de una persistent projection:

| Tipo | Error generado |
|---|---|
| `List[T]` | `List<T> requires a join table — out of scope for Phase 3` |
| `Money` | `would require multi-column expansion` |
| Cualquier VO del dominio | `is a domain type. Persistent projections only accept canonical scalar types` |
| Cualquier enum del dominio | Idem (enums son domain types) |
| Referencia a agregado | Idem |

**¿Qué hacer si el evento publica un enum?**

Declarar el campo como `String(n)` en la persistent projection y guardar el `name()` del enum.
La lógica de conversión queda en Fase 3 si es necesaria.

**¿Qué hacer si el evento publica un Money o un VO compuesto?**

Aplanar los campos relevantes como escalares en la projection:

```yaml
# ❌ No soportado
properties:
  - name: price
    type: Money

# ✅ Correcto — campos aplanados
properties:
  - name: priceAmount
    type: Decimal
    precision: 19
    scale: 4
  - name: priceCurrency
    type: String(3)
```

---

## 11. Diferencias RabbitMQ / Kafka

### Updater principal (`{Name}ProjectionUpdater`)

| Aspecto | RabbitMQ | Kafka |
|---|---|---|
| Template | `ProjectionUpdaterRabbit.java.ejs` | `ProjectionUpdaterKafka.java.ejs` |
| Annotation | `@RabbitListener(queues = "${queues.{queueKey}}")` | `@KafkaListener(topics = "${topics.{queueKey}}", groupId = "${spring.application.name}-{Name}")` |
| Firma del método | `handle(Message message, Channel channel) throws IOException` | `handle(String payload, Acknowledgment acknowledgment)` |
| Fuente del payload | `message.getBody()` (byte[]) | `payload` (String) |
| ACK en éxito | `channel.basicAck(deliveryTag, false)` | `acknowledgment.acknowledge()` |
| ACK en error de deserialización | `channel.basicNack(deliveryTag, false, false)` → DLQ | `acknowledgment.acknowledge()` → skip silencioso |
| Retry en RuntimeException | `throw e` → política de cola RabbitMQ | `throw e` → offset sin comprometer, broker reentrega |
| GroupId | — | `${spring.application.name}-{Name}` |
| Entrada en broker config | `queues` + `routing-keys` en `rabbitmq.yaml` | `topics` en `kafka.yaml` |

### Updater parcial (`{Name}On{Event}ProjectionUpdater`)

| Aspecto | RabbitMQ | Kafka |
|---|---|---|
| Template | `ProjectionPartialUpdaterRabbit.java.ejs` | `ProjectionPartialUpdaterKafka.java.ejs` |
| Annotation | `@RabbitListener(queues = "${queues.{queueKey}}")` | `@KafkaListener(topics = "${topics.{queueKey}}", groupId = "${spring.application.name}-{Name}On{Event}")` |
| Firma del método | `handle(Message message, Channel channel) throws IOException` | `handle(String payload, Acknowledgment acknowledgment)` |
| ACK en éxito | `channel.basicAck(deliveryTag, false)` | `acknowledgment.acknowledge()` |
| ACK en error de deserialización | `channel.basicNack(deliveryTag, false, false)` → DLQ | `acknowledgment.acknowledge()` → skip silencioso |
| ACK cuando fila no existe | `channel.basicAck(deliveryTag, false)` + log debug | `acknowledgment.acknowledge()` + log debug |
| Retry en RuntimeException | `throw e` | `throw e` |

---

## 12. Relación con Flyway y el campo `V2__projections.sql`

El generador sigue la convención de versionado Flyway:

| Archivo | Contenido |
|---|---|
| `V1__schema.sql` | DDL del esquema principal (agregados, entidades JPA) |
| `V2__projections.sql` | DDL de **todas** las tablas de persistent projections del sistema |

El archivo `V2__projections.sql` se genera en un solo pase al final de `generateProjectionUpdaters()`,
con el DDL de todas las proyecciones de todos los BCs procesados.

**Condición para que se genere:** al menos una persistent projection en cualquier BC del sistema.
Si no hay ninguna, el archivo no se crea y Flyway no lo necesita.

**Habilitación de Flyway:** el generador activa Flyway en `application.yml` automáticamente
cuando detecta persistent projections. Esta lógica está en `base-project-generator.js`
usando la función `hasAnyPersistentProjection()` de `projection-updater-generator.js`.

---

## 13. Errores frecuentes

### Error: tipo de VO en `properties[]`

```
Error: Persistent projection orders.LocalProductView: property "price" type "Money"
is a domain type. Persistent projections only accept canonical scalar types.
```

**Causa:** `Money` es un Value Object del dominio, no un tipo escalar.
**Solución:** aplanar los campos (`priceAmount: Decimal`, `priceCurrency: String(3)`).

### Error: `List[T]` en `properties[]`

```
Error: Persistent projection orders.LocalProductView: property "tags" of type List[String]
is not supported (List<T> requires a join table — out of scope for Phase 3).
```

**Causa:** las persistent projections solo soportan columnas simples.
**Solución:** serializar como `String` (JSON plano) o modelar la relación como tabla separada
fuera del generador.

### Error: `versionGuarded` sin campo de versión

```
Error: Persistent projection orders.LocalProductView: upsertStrategy=versionGuarded
requires either eventVersionField: <propertyName> or a property named "version".
```

**Solución:** declarar `eventVersionField: <campo>` que apunte a una propiedad existente en
`properties[]`, o renombrar la propiedad de versión a `version`.

### Error INT-010: evento no publicado

```
error  INT-010  orders.yaml#/projections[0]
Persistent projection "LocalProductView" sources event "ProductUpdated"
but catalog.yaml does not publish it.
```

**Causa:** el campo `source.event` referencia un evento que no está en `domainEvents.published[]`
del BC `source.from`.
**Solución:** verificar el nombre exacto del evento en `arch/catalog/catalog.yaml` y corregir
el YAML de `orders`.

### Error: `keyBy` apunta a un tipo no escalar

```
Error: Persistent projection orders.LocalProductView: property "productId" type "Product"
is a domain type. Persistent projections only accept canonical scalar types.
```

La propiedad indicada en `keyBy` también debe ser un tipo escalar canónico.
La PK de una tabla materializada debe ser un valor primitivo (`Uuid`, `String`, `Long`), no un VO.

### Error INT-012: evento de `additionalSources` no publicado

```
error  INT-012  orders.yaml#/projections[0]/additionalSources[0]/event
Persistent projection "LocalProductView" additionalSources[0] sources event
"ProductPriceChanged" but catalog.yaml does not publish it.
```

**Causa:** el evento declarado en `additionalSources[i].event` no está en
`domainEvents.published[]` del BC `additionalSources[i].from`.
**Solución:** verificar el nombre exacto del evento en el YAML del BC productor.

### Error: `additionalSources` en projection no persistente

```
[bc-yaml-reader] Projection "LocalProductView" declares "additionalSources"
but is not persistent. "additionalSources" is only valid when persistent: true.
```

**Solución:** añadir `persistent: true` a la proyección, o eliminar `additionalSources`.

### Error: `keyBy` incluido en `updatesFields`

```
[bc-yaml-reader] Projection "LocalProductView" additionalSources[0]: "updatesFields"
cannot include the keyBy field "productId". The primary key is never partially updated.
```

**Solución:** eliminar el campo `keyBy` de `updatesFields`. La PK solo la escribe el
updater principal cuando inserta la fila por primera vez.

### Error: campo inexistente en `updatesFields`

```
[bc-yaml-reader] Projection "LocalProductView" additionalSources[0]: "updatesFields"
references "unitCost" which is not declared in properties[].
```

**Solución:** declarar el campo en `properties[]` o corregir el nombre en `updatesFields`.
