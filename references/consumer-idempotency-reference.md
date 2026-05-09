# Referencia: Consumer Idempotency (`consumerIdempotency: true`)

Documentación 100% derivada del código del generador. Toda afirmación está respaldada
por un template, un generator o un test concreto.

---

## Tabla de contenidos

1. [El problema que resuelve](#1-el-problema-que-resuelve)
2. [Cómo activarlo](#2-cómo-activarlo)
3. [Flujo completo de deduplicación](#3-flujo-completo-de-deduplicación)
4. [Archivos Java generados](#4-archivos-java-generados)
   - 4.1 [`ProcessedEventJpa.java` — entidad JPA del log](#41-processedeventjpajava--entidad-jpa-del-log)
   - 4.2 [`ProcessedEventJpaRepository.java` — repositorio](#42-processedeventjparepositoryjava--repositorio)
   - 4.3 [`IdempotencyGuard.java` — guardia de deduplicación](#43-idempotencyguardjava--guardia-de-deduplicación)
   - 4.4 [`{EventName}KafkaListener.java` — variante con idempotencia](#44-eventnamekafkalistenerjava--variante-con-idempotencia)
   - 4.5 [`{EventName}RabbitListener.java` — variante con idempotencia](#45-eventnamerabbitlistenerjava--variante-con-idempotencia)
5. [Migración Flyway generada](#5-migración-flyway-generada)
6. [La clave `HANDLER_ID` — qué es y por qué importa](#6-la-clave-handler_id--qué-es-y-por-qué-importa)
7. [La PK compuesta `(handler_id, event_id)` — diseño deliberado](#7-la-pk-compuesta-handler_id-event_id--diseño-deliberado)
8. [Protección contra condiciones de carrera](#8-protección-contra-condiciones-de-carrera)
9. [Qué ocurre si `eventId` es null](#9-qué-ocurre-si-eventid-es-null)
10. [Relación con `outbox: true`](#10-relación-con-outbox-true)
11. [Limitaciones conocidas](#11-limitaciones-conocidas)
12. [Comparativa: con vs sin `consumerIdempotency: true`](#12-comparativa-con-vs-sin-consumeridempotency-true)
13. [Purga automática: `processedEventRetentionDays`](#13-purga-automática-processedeventretentiondays)

---

## 1. El problema que resuelve

Los message brokers (Kafka, RabbitMQ) ofrecen garantía **at-least-once delivery**: el broker
puede entregar el mismo mensaje más de una vez. Los escenarios habituales son:

**Kafka:**
- El consumer procesa el mensaje pero falla antes de confirmar el offset (`acknowledge()`).
- Al reiniciar, Kafka reentrega desde el último offset confirmado.
- El mismo mensaje se procesa dos veces.

**RabbitMQ:**
- El consumer procesa el mensaje pero falla antes de `basicAck`.
- RabbitMQ reencola el mensaje (`requeue=true`) o lo reenvía tras un timeout.
- El mismo mensaje llega de nuevo.

**Outbox + múltiples instancias:**
- Si hay múltiples instancias de la aplicación, el `OutboxRelay` de varias instancias puede
  leer la misma fila `outbox_event` pendiente y enviar el mensaje al broker más de una vez.

Sin protección, el handler del consumer ejecuta el use case por cada entrega. Si el use case
no es naturalmente idempotente (la mayoría no lo son), el resultado es corrupción de estado:
stock decrementado dos veces, pagos duplicados, órdenes creadas dos veces, etc.

**Con `consumerIdempotency: true`**, cada listener generado consulta una tabla
`processed_event` antes de despachar el use case. Si el par `(handlerId, eventId)` ya existe
en la tabla, el mensaje se descarta silenciosamente y se confirma al broker. Solo el **primer**
procesamiento ejecuta el use case y registra el par.

---

## 2. Cómo activarlo

```yaml
# arch/system/system.yaml
infrastructure:
  reliability:
    consumerIdempotency: true
```

La flag es a nivel de sistema. Afecta a **todos** los listeners generados en todos los BCs:
cada `{EventName}KafkaListener.java` y `{EventName}RabbitListener.java` del proyecto
incorpora la lógica de deduplicación.

No existe una forma de activarla solo para ciertos eventos o ciertos BCs desde el YAML de
diseño. Si se necesita idempotencia selectiva, debe añadirse manualmente en los listeners
no generados.

---

## 3. Flujo completo de deduplicación

```
Broker (Kafka / RabbitMQ)
  │
  │  entrega mensaje (puede ser duplicado)
  ▼
{EventName}KafkaListener / {EventName}RabbitListener
  │
  ├─ 1. Deserializa payload → EventEnvelope<Map<String, Object>>
  │       Si falla: ack sin dispatch (mensaje malformado, no reintentable)
  │
  ├─ 2. Extrae eventId = event.metadata().eventId()
  │       Si eventId == null → salta la guardia, despacha normalmente (ver §9)
  │
  ├─ 3. IdempotencyGuard.tryRecord(HANDLER_ID, eventId)
  │       ┌─ false (ya existe en processed_event)
  │       │     → log.debug("Duplicate …")
  │       │     → ack al broker (basicAck / acknowledgment.acknowledge())
  │       │     → return  ← use case NUNCA se ejecuta
  │       │
  │       └─ true (primera vez)
  │             → continúa al paso 4
  │
  ├─ 4. Extrae campos del payload y construye el Command
  │
  └─ 5. useCaseMediator.dispatch(command)
          OK → ack al broker
          Error → NO ack (Kafka: no acknowledge; RabbitMQ: basicNack con requeue)
                  → el mensaje se reintentará en el siguiente ciclo
                  → la fila en processed_event ya fue insertada en paso 3
                     (ver §8 para el análisis de esta condición de borde)
```

### El `tryRecord` dentro de `REQUIRES_NEW`

`IdempotencyGuard.tryRecord()` abre siempre una **transacción nueva** (`Propagation.REQUIRES_NEW`),
independientemente de cualquier transacción exterior. Esto garantiza que el INSERT en
`processed_event` se confirma en base de datos antes de que el dispatch del use case comience,
incluso si el use case rollbackea después.

---

## 4. Archivos Java generados

### Árbol de archivos

```
src/main/java/{pkg}/
└── shared/
    └── infrastructure/
        └── idempotency/
            ├── ProcessedEventJpa.java              ← entidad JPA del log
            ├── ProcessedEventJpaRepository.java    ← JPA repository
            └── IdempotencyGuard.java               ← guardia de deduplicación

src/main/resources/
└── db/
    └── migration/
        └── V1__reliability.sql                     ← DDL de processed_event (sección condicional)
```

Los 3 archivos en `shared/infrastructure/idempotency/` se generan **una sola vez por proyecto**,
independientemente del número de BCs o eventos. Los listeners se modifican **uno por cada evento
consumido** que tenga un `{EventName}KafkaListener` o `{EventName}RabbitListener` generado.

---

### 4.1 `ProcessedEventJpa.java` — entidad JPA del log

**Ruta:** `src/main/java/{pkg}/shared/infrastructure/idempotency/ProcessedEventJpa.java`
**Template:** `templates/shared/outbox/ProcessedEventJpa.java.ejs`

```java
// derived_from: system.yaml#/infrastructure/reliability/consumerIdempotency
package com.mycompany.shared.infrastructure.idempotency;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.io.Serializable;
import java.time.Instant;

/**
 * Idempotency log: records the (handlerId, eventId) pairs that have
 * already been processed by a consumer. The IdempotencyGuard consults
 * this table on every inbound message and short-circuits duplicates.
 *
 * derived_from: system.yaml#/infrastructure/reliability/consumerIdempotency
 */
@Entity
@Table(name = "processed_event")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ProcessedEventJpa {

    @EmbeddedId
    private ProcessedEventId id;

    @Column(name = "processed_at", nullable = false)
    private Instant processedAt;

    @Embeddable
    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @EqualsAndHashCode
    public static class ProcessedEventId implements Serializable {

        @Column(name = "handler_id", nullable = false, length = 512)
        private String handlerId;

        @Column(name = "event_id", nullable = false, length = 64)
        private String eventId;
    }
}
```

#### Semántica de los campos

| Campo JPA | Columna SQL | Tipo Java | Descripción |
|---|---|---|---|
| `id.handlerId` | `handler_id` `VARCHAR(512)` | `String` | FQN de la clase listener: `{packageName}.{bc}.{listenerClassName}`. Distingue el mismo `eventId` procesado por listeners distintos. Ver §6. |
| `id.eventId` | `event_id` `VARCHAR(64)` | `String` | UUID del evento, extraído de `event.metadata().eventId()`. Proviene del `EventEnvelope` serializado por el publicador. |
| `processedAt` | `processed_at` `TIMESTAMP` | `Instant` | Momento de primer procesamiento. Solo informativo — no es parte de la lógica de deduplicación. |

#### Por qué `@EmbeddedId` y no `@IdClass`

La PK compuesta se modela con `@EmbeddedId` y una clase interna `ProcessedEventId implements Serializable`.
Esto permite usar `repository.existsById(pk)` y `repository.save(entity)` con la PK ya construida,
sin necesidad de queries JPQL custom. Ver §7 para el análisis del diseño de la PK.

---

### 4.2 `ProcessedEventJpaRepository.java` — repositorio

**Ruta:** `src/main/java/{pkg}/shared/infrastructure/idempotency/ProcessedEventJpaRepository.java`
**Template:** `templates/shared/outbox/ProcessedEventJpaRepository.java.ejs`

**Sin `processedEventRetentionDays`:**

```java
// derived_from: system.yaml#/infrastructure/reliability/consumerIdempotency
package com.mycompany.shared.infrastructure.idempotency;

import org.springframework.data.jpa.repository.JpaRepository;

public interface ProcessedEventJpaRepository
    extends JpaRepository<ProcessedEventJpa, ProcessedEventJpa.ProcessedEventId> {
}
```

**Con `processedEventRetentionDays: N`** — se añade el método de purga:

```java
// derived_from: system.yaml#/infrastructure/reliability/consumerIdempotency
package com.mycompany.shared.infrastructure.idempotency;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.Instant;

public interface ProcessedEventJpaRepository
    extends JpaRepository<ProcessedEventJpa, ProcessedEventJpa.ProcessedEventId> {

    /**
     * Deletes all processed-event rows older than {@code cutoff}.
     * Called by {@link IdempotencyGuard#purge()} on a scheduled basis.
     *
     * @return number of rows deleted
     */
    @Modifying
    @Query("delete from ProcessedEventJpa o where o.processedAt < :cutoff")
    int deleteProcessedBefore(@Param("cutoff") Instant cutoff);
}
```

Toda la lógica de consulta e inserción de deduplicación se hace a través de los métodos
heredados de `JpaRepository`:

- `existsById(ProcessedEventId pk)` → `SELECT COUNT(*) FROM processed_event WHERE handler_id=? AND event_id=?`
- `save(ProcessedEventJpa entity)` → `INSERT INTO processed_event (handler_id, event_id, processed_at) VALUES (?,?,?)`

El método `deleteProcessedBefore` usa `@Modifying` porque ejecuta un DELETE JPQL. El nombre
de entidad en la query es `ProcessedEventJpa` (clase JPA) y `processedAt` es el atributo Java.
No hay filtro `IS NOT NULL` porque `processed_at` es `NOT NULL` en todas las filas (ver §5).

---

### 4.3 `IdempotencyGuard.java` — guardia de deduplicación

**Ruta:** `src/main/java/{pkg}/shared/infrastructure/idempotency/IdempotencyGuard.java`
**Template:** `templates/shared/outbox/IdempotencyGuard.java.ejs`

**Sin `processedEventRetentionDays`** (el `Logger` se genera siempre; no hay `purge()`):

```java
// derived_from: system.yaml#/infrastructure/reliability/consumerIdempotency
package com.mycompany.shared.infrastructure.idempotency;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

/**
 * Consumer-side idempotency guard.
 *
 * Listeners call tryRecord(handlerId, eventId) before dispatching the
 * inbound message. The guard atomically inserts a (handlerId, eventId)
 * row and reports true for first occurrences, false for duplicates
 * (PK violation caught and swallowed).
 *
 * derived_from: system.yaml#/infrastructure/reliability/consumerIdempotency
 */
@Component
public class IdempotencyGuard {

    private static final Logger log = LoggerFactory.getLogger(IdempotencyGuard.class);

    private final ProcessedEventJpaRepository repository;

    public IdempotencyGuard(ProcessedEventJpaRepository repository) {
        this.repository = repository;
    }

    /**
     * Returns true if this is the first time the pair is seen and the
     * caller MUST process the message; false if it has been processed
     * before and the caller MUST skip.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean tryRecord(String handlerId, String eventId) {
        ProcessedEventJpa.ProcessedEventId pk = ProcessedEventJpa.ProcessedEventId.builder()
            .handlerId(handlerId)
            .eventId(eventId)
            .build();
        if (repository.existsById(pk)) {
            return false;
        }
        try {
            repository.save(ProcessedEventJpa.builder()
                .id(pk)
                .processedAt(Instant.now())
                .build());
            return true;
        } catch (DataIntegrityViolationException duplicate) {
            return false;
        }
    }
}
```

**Con `processedEventRetentionDays: N`** — se añaden el campo `retentionDays` y el método `purge()` antes de `tryRecord()`. Se muestran solo los elementos adicionales respecto al caso base:

```java
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import java.time.temporal.ChronoUnit;
// ↑ imports adicionales, generados condicionalmente

@Component
public class IdempotencyGuard {

    private static final Logger log = LoggerFactory.getLogger(IdempotencyGuard.class);

    private final ProcessedEventJpaRepository repository;

    @Value("${processed-event.purge.retention-days:N}")   // N = valor de processedEventRetentionDays
    private int retentionDays;

    public IdempotencyGuard(ProcessedEventJpaRepository repository) {
        this.repository = repository;
    }

    @Scheduled(cron = "${processed-event.purge.cron:0 0 4 * * *}")
    @Transactional
    public void purge() {
        Instant cutoff = Instant.now().minus(retentionDays, ChronoUnit.DAYS);
        int deleted = repository.deleteProcessedBefore(cutoff);
        if (deleted > 0) {
            log.info("Idempotency purge: deleted {} processed rows older than {} days",
                     deleted, retentionDays);
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean tryRecord(String handlerId, String eventId) { ... }
}
```

#### Comportamiento de `tryRecord` paso a paso

```
tryRecord(handlerId, eventId)
  │
  ├─ Abre transacción REQUIRES_NEW (nueva conexión de BD, independiente del caller)
  │
  ├─ existsById(pk) → SELECT WHERE handler_id=? AND event_id=?
  │     true  → return false  (duplicado detectado por SELECT — caso habitual en retry)
  │     false → continúa
  │
  ├─ repository.save(entity) → INSERT INTO processed_event ...
  │     OK                  → return true  (primera vez, caller debe procesar)
  │     DataIntegrityViolation (PK dup) → return false
  │                          (race condition: otra instancia insertó primero, ver §8)
  │
  └─ Cierra (commit) la transacción REQUIRES_NEW
```

#### `Propagation.REQUIRES_NEW` — por qué es crítico

Los listeners no tienen una transacción activa al llamar a `tryRecord` (no están anotados
con `@Transactional`). Sin embargo, si en el futuro el listener adquiriera una transacción,
`REQUIRES_NEW` garantiza que el INSERT en `processed_event` se confirma en su propia
transacción antes de que el use case comience.

Si se usara `REQUIRED` (el default) y el use case lanzara una excepción, el INSERT en
`processed_event` se desharía junto con la transacción del use case. En el siguiente reintento,
el mismo `eventId` parecería nuevo y el use case se ejecutaría otra vez — exactamente el
problema que se quiere evitar.

Con `REQUIRES_NEW` la fila en `processed_event` **siempre persiste**, independientemente
de lo que ocurra después en el listener. Esto tiene una consecuencia importante que se
analiza en §11 (limitaciones).

---

### 4.4 `{EventName}KafkaListener.java` — variante con idempotencia

**Ruta:** `src/main/java/{pkg}/{bc}/infrastructure/kafkaListener/{EventName}KafkaListener.java`
**Template:** `templates/messaging/KafkaListener.java.ejs` (secciones `consumerIdempotencyEnabled`)

Diferencias respecto a la variante sin idempotencia:

**1. Import adicional:**
```java
import com.mycompany.shared.infrastructure.idempotency.IdempotencyGuard;
```

**2. Campo y constante adicionales:**
```java
private final IdempotencyGuard idempotencyGuard;
private static final String HANDLER_ID = "com.mycompany.inventory.ProductActivatedKafkaListener";
```

**3. Parámetro en el constructor:**
```java
public ProductActivatedKafkaListener(
    UseCaseMediator useCaseMediator,
    ObjectMapper objectMapper,
    IdempotencyGuard idempotencyGuard          // ← inyectado por Spring
) {
    this.useCaseMediator = useCaseMediator;
    this.objectMapper = objectMapper;
    this.idempotencyGuard = idempotencyGuard;
}
```

**4. Bloque de deduplicación en `handle()`, después de deserializar y antes de extraer campos:**
```java
// derived_from: system.yaml#/infrastructure/reliability/consumerIdempotency
String eventId = event.metadata() != null ? event.metadata().eventId() : null;
if (eventId != null && !idempotencyGuard.tryRecord(HANDLER_ID, eventId)) {
    log.debug("Duplicate eventId={} for handler={} — acknowledging without dispatch",
              eventId, HANDLER_ID);
    acknowledgment.acknowledge();   // confirma el offset; el mensaje no se reprocesará
    return;
}
```

El listener completo con idempotencia activada, para el evento `ProductActivated` en BC `inventory`:

```java
@Component("inventory.ProductActivatedKafkaListener")
public class ProductActivatedKafkaListener {

    private static final Logger log = LoggerFactory.getLogger(ProductActivatedKafkaListener.class);

    private final UseCaseMediator useCaseMediator;
    private final ObjectMapper objectMapper;
    private final IdempotencyGuard idempotencyGuard;
    private static final String HANDLER_ID =
        "com.mycompany.inventory.ProductActivatedKafkaListener";

    public ProductActivatedKafkaListener(
            UseCaseMediator useCaseMediator,
            ObjectMapper objectMapper,
            IdempotencyGuard idempotencyGuard) {
        this.useCaseMediator = useCaseMediator;
        this.objectMapper = objectMapper;
        this.idempotencyGuard = idempotencyGuard;
    }

    @KafkaListener(
        topics = "${topics.product-activated}",
        groupId = "${spring.kafka.consumer.group-id}"
    )
    public void handle(ConsumerRecord<String, String> record, Acknowledgment acknowledgment) {

        // 1. Deserializar
        EventEnvelope<Map<String, Object>> event;
        try {
            event = objectMapper.readValue(
                record.value(),
                new TypeReference<EventEnvelope<Map<String, Object>>>() {});
        } catch (JsonProcessingException e) {
            log.error("Fatal deserialization error — skipping message: {}", e.getMessage());
            acknowledgment.acknowledge();
            return;
        }

        // 2. Guardia de idempotencia
        String eventId = event.metadata() != null ? event.metadata().eventId() : null;
        if (eventId != null && !idempotencyGuard.tryRecord(HANDLER_ID, eventId)) {
            log.debug("Duplicate eventId={} for handler={} — acknowledging without dispatch",
                      eventId, HANDLER_ID);
            acknowledgment.acknowledge();
            return;
        }

        // 3. Extraer campos del payload
        UUID productId = objectMapper.convertValue(
            event.data().get("productId"), UUID.class);
        String productName = objectMapper.convertValue(
            event.data().get("productName"), String.class);

        // 4. Despachar use case
        try {
            useCaseMediator.dispatch(new RegisterProductInCatalogCommand(productId, productName));
            acknowledgment.acknowledge();
        } catch (Exception e) {
            log.error("Error dispatching RegisterProductInCatalogCommand: {}", e.getMessage(), e);
            // No acknowledge — Kafka reintentará según configuración del consumer
        }
    }
}
```

---

### 4.5 `{EventName}RabbitListener.java` — variante con idempotencia

**Ruta:** `src/main/java/{pkg}/{bc}/infrastructure/rabbitListener/{EventName}RabbitListener.java`
**Template:** `templates/messaging/RabbitListener.java.ejs` (secciones `consumerIdempotencyEnabled`)

Las diferencias respecto a la variante sin idempotencia son idénticas en estructura a las
de Kafka (import, campo, constante, constructor, bloque de deduplicación). La única diferencia
está en el mecanismo de confirmación al broker:

```java
// Dentro de handle(Message message, Channel channel):

// 2. Guardia de idempotencia
String eventId = event.metadata() != null ? event.metadata().eventId() : null;
if (eventId != null && !idempotencyGuard.tryRecord(HANDLER_ID, eventId)) {
    log.debug("Duplicate eventId={} for handler={} — acknowledging without dispatch",
              eventId, HANDLER_ID);
    channel.basicAck(deliveryTag, false);   // ACK: descarta el duplicado del queue
    return;
}
```

En RabbitMQ el duplicado se confirma con `basicAck` (no `basicNack`): el mensaje se elimina
de la cola definitivamente, sin pasar a la DLQ ni reencolarse. El duplicado entra, se detecta
y se descarta sin ruido en el broker.

---

## 5. Migración Flyway generada

**Ruta:** `src/main/resources/db/migration/V1__reliability.sql`
**Template:** `templates/base/resources/db/migration/V1__reliability.sql.ejs`

Cuando `consumerIdempotency: true`, el mismo archivo `V1__reliability.sql` que puede
contener la tabla `outbox_event` incluye además la sección de idempotencia:

```sql
-- Sección generada solo cuando consumerIdempotency: true
CREATE TABLE IF NOT EXISTS processed_event (
    handler_id   VARCHAR(512) NOT NULL,
    event_id     VARCHAR(64)  NOT NULL,
    processed_at TIMESTAMP    NOT NULL,
    CONSTRAINT pk_processed_event PRIMARY KEY (handler_id, event_id)
);
```

#### Notas del DDL

- **Sin índice adicional.** La PK `(handler_id, event_id)` crea automáticamente un índice
  B-tree en PostgreSQL que cubre exactamente la única query usada: `WHERE handler_id=? AND event_id=?`.
  No se añade ningún índice extra porque no hay queries que filtren solo por un campo.

- **`handler_id VARCHAR(512)`.** Reserva espacio suficiente para FQNs largos del estilo
  `com.mycompany.verylong.module.infrastructure.kafkaListener.SomeVeryLongEventKafkaListener`.

- **`event_id VARCHAR(64)`.** Un UUID v4 serializado como string ocupa 36 caracteres
  (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`). El ancho de 64 da margen para otros formatos.

- **`processed_at TIMESTAMP NOT NULL`.** Solo informativo. No participa en la lógica de
  deduplicación. Útil para debugging y para políticas de retención.

- **Sin columna `status` ni `attempts`.** A diferencia de `outbox_event`, no hay reintentos
  ni estados intermedios. Una fila en `processed_event` significa simplemente "ya visto" —
  no hay transiciones de estado.

---

## 6. La clave `HANDLER_ID` — qué es y por qué importa

Cada listener generado declara una constante estática:

```java
private static final String HANDLER_ID = "{packageName}.{bc}.{ListenerClassName}";
```

Por ejemplo:
```java
// BC inventory, evento ProductActivated, broker Kafka
private static final String HANDLER_ID =
    "com.mycompany.inventory.ProductActivatedKafkaListener";

// BC orders, evento ProductDiscontinued, broker RabbitMQ
private static final String HANDLER_ID =
    "com.mycompany.orders.ProductDiscontinuedRabbitListener";
```

#### Por qué `HANDLER_ID` y no solo `eventId`

El `eventId` identifica un evento específico en el mundo, pero **el mismo evento puede
ser consumido por múltiples listeners en múltiples BCs**. El `HANDLER_ID` + `eventId` juntos
identifican unívocamente "este listener ha procesado este evento".

**Ejemplo sin `HANDLER_ID`:**
- El evento `ProductDiscontinued` con `eventId=abc-123` llega tanto al BC `orders` como al BC `catalog`.
- Si la deduplicación usara solo `eventId`, el primer listener en registrar `abc-123` bloquearía al segundo.
- El evento sería procesado solo una vez en un BC y nunca en el otro.

**Con `HANDLER_ID`:**
- `orders.ProductDiscontinuedRabbitListener` registra `(orders.ProductDiscontinuedRabbitListener, abc-123)`.
- `catalog.ProductDiscontinuedRabbitListener` registra `(catalog.ProductDiscontinuedRabbitListener, abc-123)`.
- Ambos procesamiento son independientes. Solo se bloquean duplicados dentro del mismo handler.

---

## 7. La PK compuesta `(handler_id, event_id)` — diseño deliberado

La tabla `processed_event` no tiene una columna `id` autogenerada. La PK es directamente
la pareja `(handler_id, event_id)`. Este diseño tiene consecuencias prácticas:

**Ventaja — detección de duplicados con `INSERT` puro:**

La base de datos rechaza automáticamente el segundo INSERT del mismo par como violación de
PK. `IdempotencyGuard` captura `DataIntegrityViolationException` y retorna `false` sin
necesidad de un `SELECT` previo en condiciones de carrera. Ver §8.

**Ventaja — sin secuencias ni `RETURNING`:**

No hay `@GeneratedValue`. El generador no necesita ningún mecanismo de generación de IDs
porque la PK es siempre conocida antes del INSERT.

**Consecuencia — crecimiento indefinido de la tabla (sin purga configurada):**

La tabla crece una fila por mensaje procesado, indefinidamente. Si no se activa
`processedEventRetentionDays`, no hay ningún mecanismo de purga generado. Ver §11 y §13.

---

## 8. Protección contra condiciones de carrera

Con múltiples instancias de la aplicación, el siguiente escenario es posible:

```
T1: Instancia A — existsById(pk)  → false  (fila no existe)
T2: Instancia B — existsById(pk)  → false  (fila no existe, misma condición)
T3: Instancia A — save(entity)    → INSERT OK
T4: Instancia B — save(entity)    → DataIntegrityViolationException (PK duplicada)
```

`IdempotencyGuard` captura `DataIntegrityViolationException` en el `catch` y retorna `false`,
exactamente igual que si hubiera encontrado la fila en el `existsById`. El listener de la
instancia B trata el mensaje como duplicado y lo confirma al broker sin despachar el use case.

Este patrón — `SELECT` optimista + `INSERT` + captura de violación de PK — es la forma
estándar de implementar idempotencia sin locks distribuidos. El `existsById` previo es una
optimización para evitar la excepción en el caso habitual de retry (donde la fila ya existe);
el `DataIntegrityViolationException` es el mecanismo de seguridad real para la condición
de carrera.

---

## 9. Qué ocurre si `eventId` es null

El bloque de deduplicación en el listener es:

```java
String eventId = event.metadata() != null ? event.metadata().eventId() : null;
if (eventId != null && !idempotencyGuard.tryRecord(HANDLER_ID, eventId)) {
    // ... descarta
}
```

La condición `eventId != null` hace que la guardia sea **un no-op** si el evento no tiene
`metadata` o si `metadata.eventId()` es null. En ese caso el use case se despacha sin
verificación de idempotencia.

Esto puede ocurrir si:
- El publicador no incluye `EventMetadata` en el `EventEnvelope` (no debería ocurrir con
  el código generado, ya que `EventEnvelope.of(...)` siempre genera metadatos).
- El evento llega de un sistema externo que no incluye `metadata` en el wrapper.

En estos casos la idempotencia no opera. Es responsabilidad del diseñador garantizar que
todos los eventos que requieran deduplicación tengan `eventId` poblado.

---

## 10. Relación con `outbox: true`

Las dos flags son complementarias y resuelven problemas en lados opuestos de la comunicación:

| Flag | Lado | Garantía |
|---|---|---|
| `outbox: true` | **Publicador** | El evento llega al broker al menos una vez (no se pierde si la app falla tras el COMMIT) |
| `consumerIdempotency: true` | **Consumidor** | El use case se ejecuta exactamente una vez por entrega única (no se duplica si el broker reentrega) |

Juntas forman el patrón **at-least-once + idempotent consumer = effectively-exactly-once**:
el publicador garantiza que el evento llegará (al menos una vez) y el consumidor garantiza
que se procesará exactamente una vez.

Ninguna de las dos flags requiere la otra para funcionar. Se pueden activar de forma
independiente según las necesidades del sistema:

```yaml
reliability:
  outbox: true               # solo publicador
  consumerIdempotency: false # consumidores asumen at-most-once o son naturalmente idempotentes
```

```yaml
reliability:
  outbox: false              # publicación directa (at-most-once)
  consumerIdempotency: true  # consumidores protegidos contra redelivery del broker
```

---

## 11. Limitaciones conocidas

### La tabla `processed_event` crece indefinidamente si no se configura la purga

Cada mensaje procesado exitosamente añade una fila. En sistemas con alto throughput de
eventos, la tabla puede crecer a millones de filas con el tiempo, degradando la performance
del `existsById`.

El generador puede emitir un job de purga automático activando `processedEventRetentionDays`
en el YAML de sistema (ver §13). Si no se activa, la estrategia de purga debe implementarse
manualmente (p.ej. un job programado que borre filas con `processed_at` anterior a N días,
asumiendo que mensajes con más de N días de antigüedad ya no serán reentregados por el broker).

### La fila en `processed_event` persiste aunque el use case falle

`tryRecord` usa `REQUIRES_NEW` — su transacción confirma antes de que el use case comience.
Si el use case lanza una excepción después:

- El listener **no** hace `acknowledge` (Kafka) o hace `basicNack` (RabbitMQ).
- El broker reentrega el mensaje.
- En la siguiente entrega, `tryRecord` encontrará la fila y retornará `false`.
- El use case **nunca se ejecutará** para este `eventId` + `handlerId`.

Este comportamiento garantiza que un mensaje "envenenado" (que siempre falla el use case)
no cause un bucle infinito de reintentos, pero implica que el primer fallo es **definitivo**:
el evento queda registrado como "procesado" aunque el use case no haya completado con éxito.

Si se necesita que el use case tenga oportunidad de reintentar ante fallos transitorios,
la estrategia correcta es: el use case debe ser lo suficientemente robusto para tolerar
reintentos, o implementar un mecanismo de compensación manual.

### Sin soporte para eventos sin `metadata.eventId`

Como se explica en §9, la guardia no opera si `eventId` es null. No hay ninguna validación
en tiempo de generación que verifique que los eventos publicados incluyen `eventId`.

---

## 12. Comparativa: con vs sin `consumerIdempotency: true`

| Aspecto | Sin idempotencia | Con `consumerIdempotency: true` |
|---|---|---|
| Dependencias del listener | `UseCaseMediator` + `ObjectMapper` | + `IdempotencyGuard` |
| Lógica antes del dispatch | Ninguna | `tryRecord(HANDLER_ID, eventId)` |
| Tabla de BD | No | Sí — `processed_event` |
| Migración Flyway | Solo si hay otras flags | Sí — sección en `V1__reliability.sql` |
| Comportamiento ante redelivery | Use case ejecutado N veces (una por entrega) | Use case ejecutado 1 vez; duplicados confirmados silenciosamente |
| Comportamiento si `eventId` es null | Normal (dispatch) | Normal (dispatch) — guardia no opera |
| Comportamiento si use case falla | No ack → broker reintenta → use case puede reintentar | No ack → broker reintenta → fila ya existe → use case **no** reintenta |
| Crecimiento de tabla | N/A | Una fila por mensaje procesado; purga automática opcional con `processedEventRetentionDays` (ver §13) |
| Protección contra race conditions | N/A | `DataIntegrityViolationException` capturada en `tryRecord` |
| Relación con `outbox: true` | Independiente | Complementaria — forman effectively-exactly-once juntas |

---

## 13. Purga automática: `processedEventRetentionDays`

### Cómo activarla

```yaml
# arch/system/system.yaml
infrastructure:
  reliability:
    consumerIdempotency: true
    processedEventRetentionDays: 14   # días de retención; entero ≥ 1
```

`processedEventRetentionDays` requiere que `consumerIdempotency: true` esté activo.
Si `consumerIdempotency` es falso, el campo no tiene efecto (no se generan artefactos
de idempotencia y por tanto no hay tabla `processed_event` que purgar).

### Qué genera el generador

Activar `processedEventRetentionDays: N` produce dos cambios adicionales en los artefactos
de idempotencia:

**1. `ProcessedEventJpaRepository.java`** — método de borrado por fecha:

```java
@Modifying
@Query("delete from ProcessedEventJpa o where o.processedAt < :cutoff")
int deleteProcessedBefore(@Param("cutoff") Instant cutoff);
```

**2. `IdempotencyGuard.java`** — campo `retentionDays` configurable + método `purge()` planificado:

```java
@Value("${processed-event.purge.retention-days:N}")
private int retentionDays;

@Scheduled(cron = "${processed-event.purge.cron:0 0 4 * * *}")
@Transactional
public void purge() {
    Instant cutoff = Instant.now().minus(retentionDays, ChronoUnit.DAYS);
    int deleted = repository.deleteProcessedBefore(cutoff);
    if (deleted > 0) {
        log.info("Idempotency purge: deleted {} processed rows older than {} days",
                 deleted, retentionDays);
    }
}
```

**3. `Application.java`** — `@EnableScheduling` se activa cuando `outbox: true` **o**
`processedEventRetentionDays ≥ 1`. Un proyecto con solo `consumerIdempotency: true` +
`processedEventRetentionDays: N` (sin `outbox: true`) también recibe `@EnableScheduling`.

### Semántica del job de purga

| Aspecto | Valor |
|---|---|
| Cron por defecto | `0 0 4 * * *` (diariamente a las 04:00) |
| Cron configurable en runtime | `${processed-event.purge.cron:...}` |
| Retención por defecto | Valor de `processedEventRetentionDays` en el YAML |
| Retención configurable en runtime | `${processed-event.purge.retention-days:N}` |
| Propagación de transacción | `@Transactional` REQUIRED — DELETE en batch, sin aislamiento especial |
| Log si no hay filas eliminadas | Sin log (silencioso) |
| Log si hay filas eliminadas | `INFO` — número de filas + días de retención |

### Cron default: 04:00

El cron del job de idempotencia es `0 0 4 * * *` (04:00), una hora después del cron del
purge de `OutboxRelay` que es `0 0 3 * * *` (03:00). Esta separación es intencional:
evita que ambos jobs compitan por conexiones de base de datos simultáneamente.

### Criterio de purga

El criterio de purga es:

```
processed_at < NOW() - retentionDays DAYS
```

Una fila se purga cuando su `processed_at` es anterior al corte. El criterio asume que
el broker **no reentregará** mensajes con más de `retentionDays` días de antigüedad.

Si el broker reentregara un mensaje con `eventId` cuya fila ya fue purgada, ese mensaje
se procesaría como nuevo (la guardia no lo detectaría como duplicado). Configurar
`processedEventRetentionDays` con un valor inferior al tiempo de retención del broker
es un error de configuración.

### Sin cambios en el DDL

La purga no requiere cambios en `V1__reliability.sql`. La columna `processed_at TIMESTAMP NOT NULL`
ya existe y es el campo usado en el DELETE JPQL. No se añaden índices adicionales porque
el DELETE por `processedAt` es un full-scan esperado en un job batch planificado — no es
una query de latencia crítica.
