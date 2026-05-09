# Referencia: Patrón Transactional Outbox (`outbox: true`)

Documentación 100% derivada del código del generador. Toda afirmación está respaldada
por un template, un generator o un test concreto.

---

## Tabla de contenidos

1. [El problema que resuelve](#1-el-problema-que-resuelve)
2. [Cómo activarlo](#2-cómo-activarlo)
3. [Flujo completo de emisión de un evento](#3-flujo-completo-de-emisión-de-un-evento)
4. [Archivos Java generados](#4-archivos-java-generados)
   - 4.1 [`OutboxEventJpa.java` — entidad JPA](#41-outboxeventjpajava--entidad-jpa)
   - 4.2 [`OutboxEventJpaRepository.java` — repositorio](#42-outboxeventjparepositoryjava--repositorio)
   - 4.3 [`OutboxRelay.java` — relay programado](#43-outboxrelayjava--relay-programado)
   - 4.4 [`{BcPascal}DomainEventHandler.java` — variante outbox](#44-bcpascaldomaineventhandlerjava--variante-outbox)
5. [Migración Flyway generada](#5-migración-flyway-generada)
6. [Diferencias según el broker](#6-diferencias-según-el-broker)
7. [Efecto en `build.gradle` y `Application.java`](#7-efecto-en-buildgradle-y-applicationjava)
8. [Limitaciones conocidas del generador](#8-limitaciones-conocidas-del-generador)
9. [Comparativa: con vs sin `outbox: true`](#9-comparativa-con-vs-sin-outbox-true)

---

## 1. El problema que resuelve

Sin outbox, el flujo de publicación de un evento es:

```
Use case handler
  └─ repositorio.save(aggregate)        ← transacción JPA
       └─ ApplicationEventPublisher.publishEvent(domainEvent)  ← dentro de la transacción
            └─ DomainEventHandler (@TransactionalEventListener AFTER_COMMIT)
                 └─ MessageBroker.publishXxxEvent(...)          ← FUERA de la transacción
                      └─ rabbitTemplate.send(...)  / kafkaTemplate.send(...)
```

**Riesgo:** entre el COMMIT de la base de datos y la llamada al broker pueden ocurrir:

- Reinicio de la aplicación.
- Excepción en el broker (red caída, timeout, etc.).
- GC pause suficientemente larga.

Si alguno de estos casos ocurre, el aggregate ya está persistido pero el evento **nunca llega
al broker**. Los consumidores del evento nunca se enteran del cambio de estado.

**Con `outbox: true`**, la escritura en la tabla `outbox_event` forma parte de la misma
transacción que la escritura del aggregate. El relay publica asíncronamente. Si el relay
falla, el evento sigue en la tabla y se reintenta. Si la transacción hace rollback, la fila
del outbox también hace rollback — nunca queda un evento "fantasma".

---

## 2. Cómo activarlo

```yaml
# arch/system/system.yaml
infrastructure:
  messageBroker: true    # flag: el sistema usa mensajería asíncrona
  reliability:
    outbox: true
    outboxRetentionDays: 7   # opcional — días de retención para filas publicadas
```

La propiedad que controla todo es `system.infrastructure.reliability.outbox: true`.
El generador la lee desde `outbox-generator.js`:

```js
const outboxEnabled = !!reliability.outbox;
```

No existe ninguna propiedad en el `{bc}.yaml` que controle el outbox — la decisión
es a nivel de sistema, no de BC.

### `outboxRetentionDays` — purga de filas publicadas

`outboxRetentionDays` es un entero ≥ 1 **opcional**. Cuando está presente, el generador
añade al `OutboxRelay` un método `purge()` programado que elimina las filas con
`published_at IS NOT NULL` más antiguas que el umbral. También añade
`deletePublishedBefore()` al repositorio.

Cuando está ausente o es menor que 1, **no se genera ningún código de purga**;
la tabla `outbox_event` crece indefinidamente (ver [§8](#8-limitaciones-conocidas-del-generador)).

El generador deriva internamente:

```js
const outboxRetentionDays = typeof reliability.outboxRetentionDays === 'number'
    ? reliability.outboxRetentionDays : null;
const purgeEnabled = outboxRetentionDays !== null && outboxRetentionDays >= 1;
const retentionDays = purgeEnabled ? outboxRetentionDays : 7;  // valor de respaldo para el default del @Value
```

`retentionDays` se usa como **valor por defecto** del `@Value` en el relay:
`${outbox.purge.retention-days:<retentionDays>}`. Puede sobreescribirse en
`application.yaml` sin regenear código.

---

## 3. Flujo completo de emisión de un evento

Con `outbox: true` el flujo es:

```
┌─────────────────────────────────── TRANSACCIÓN JPA ──────────────────────────────────────┐
│                                                                                            │
│  1. UseCaseHandler.execute()                                                               │
│       └─ aggregate.someMethod()          ← agrega evento al bus interno del aggregate      │
│            └─ raise(new XxxEvent(...))   ← acumula en List<DomainEvent> _domainEvents      │
│                                                                                            │
│  2. repository.save(aggregate)                                                             │
│       ├─ jpaRepository.save(mapper.toJpa(aggregate))  ← persiste el aggregate             │
│       └─ aggregate.pullDomainEvents()                  ← vacía _domainEvents              │
│            └─ eventPublisher.publishEvent(event)       ← Spring ApplicationEventPublisher  │
│                 └─ DomainEventHandler.onXxxEvent()     ← @EventListener (síncrono)         │
│                      ├─ construye IntegrationEvent a partir del DomainEvent                │
│                      ├─ envuelve en EventEnvelope.of(routingKey, integrationEvent, corrId) │
│                      ├─ serializa envelope → JSON (ObjectMapper)                           │
│                      └─ outboxRepository.save(OutboxEventJpa)  ← INSERTA FILA OUTBOX      │
│                                                                                            │
│  COMMIT ─────────────────────────────────────────────────────────────────────────────────  │
└────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────── FUERA DE TRANSACCIÓN (scheduled, hilo separado) ─────────────────────┐
│                                                                                           │
│  3. OutboxRelay.relay()  (cada 1000ms por defecto)                                        │
│       ├─ outboxRepository.findPending(PageRequest.of(0, 100))                             │
│       │    └─ SELECT ... WHERE published_at IS NULL ORDER BY created_at ASC               │
│       └─ for each row:                                                                    │
│            ├─ broker.send(destination, routingKey/partitionKey, payload)                  │
│            │   [RabbitMQ] rabbitTemplate.send(exchange, routingKey, Message)              │
│            │   [Kafka]    kafkaTemplate.send(topic, routingKey, payload).get()             │
│            ├─ OK:   row.setPublishedAt(Instant.now()) → outboxRepository.save(row)        │
│            └─ FAIL: row.setAttempts(+1) + row.setLastError(...) → outboxRepository.save() │
│                     (la fila queda pending y se reintentará en el siguiente ciclo)         │
│                                                                                            │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

### Puntos clave del flujo

**Paso 2 — `@EventListener` vs `@TransactionalEventListener`**

| Modo | Anotación | Cuándo se ejecuta |
|---|---|---|
| Sin outbox | `@TransactionalEventListener(phase = AFTER_COMMIT)` | Después del COMMIT — el broker recibe el mensaje, pero si falla no hay retries automáticos |
| Con outbox | `@EventListener` (ordinario) | **Dentro de la transacción** — permite persistir la fila outbox en el mismo COMMIT |

Con `outbox: true` el template genera `@EventListener` puro porque necesita que la
escritura en `outbox_event` sea parte del COMMIT del aggregate. Si se usara
`@TransactionalEventListener(AFTER_COMMIT)`, la fila se insertaría fuera de la transacción
del aggregate y se perdería la garantía de atomicidad.

**Paso 2 — serialización previa**

El payload que se guarda en la fila outbox es el JSON del `EventEnvelope<IntegrationEvent>`
ya serializado. El relay no necesita conocer los tipos Java; envía el JSON verbatim. Esto
desacopla el relay de la lógica de dominio y permite ejecutarlo como un proceso independiente.

**Paso 3 — `BATCH_SIZE = 100`**

El relay procesa hasta 100 filas por ciclo. La query usa `ORDER BY created_at ASC` para
respetar el orden de inserción (FIFO por aggregate, no globalmente ordenado entre aggregates).

**Paso 3 — `kafkaTemplate.send(...).get()`**

Para Kafka, el relay espera confirmación del broker (`Future.get()`). Esto hace el relay
bloqueante pero garantiza que no marca la fila como publicada antes de que Kafka haya
aceptado el mensaje.

---

## 4. Archivos Java generados

### Árbol de archivos

```
src/main/java/{pkg}/
├── shared/
│   └── infrastructure/
│       └── outbox/
│           ├── OutboxEventJpa.java                    ← entidad JPA de la tabla
│           ├── OutboxEventJpaRepository.java          ← JPA repository
│           └── OutboxRelay.java                       ← relay programado
└── {bc}/
    └── application/
        └── usecases/
            └── {BcPascal}DomainEventHandler.java      ← variante con @EventListener

src/main/resources/
└── db/
    └── migration/
        └── V1__reliability.sql                        ← DDL de outbox_event
```

Los 3 archivos en `shared/infrastructure/outbox/` se generan **una sola vez por proyecto**,
independientemente del número de BCs. El `DomainEventHandler` se genera **una vez por BC**
que tenga eventos publicados con `scope ≠ internal`.

---

### 4.1 `OutboxEventJpa.java` — entidad JPA

**Ruta:** `src/main/java/{pkg}/shared/infrastructure/outbox/OutboxEventJpa.java`
**Template:** `templates/shared/outbox/OutboxEventJpa.java.ejs`

```java
@Entity
@Table(name = "outbox_event")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class OutboxEventJpa {

    @Id
    @Column(name = "id", columnDefinition = "uuid", nullable = false, updatable = false)
    private UUID id;

    /** Exchange name (RabbitMQ) or topic name (Kafka). */
    @Column(name = "destination", nullable = false, length = 255)
    private String destination;

    /** Routing key (RabbitMQ) or partition key (Kafka). May be null for Kafka. */
    @Column(name = "routing_key", length = 255)
    private String routingKey;

    /** FQN of the integration event class (for traceability). */
    @Column(name = "event_type", nullable = false, length = 512)
    private String eventType;

    /** Pre-serialized EventEnvelope<IntegrationEvent> as JSON. */
    @Column(name = "payload", nullable = false, columnDefinition = "TEXT")
    private String payload;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /** Set when the broker has accepted the message. null = pending. */
    @Column(name = "published_at")
    private Instant publishedAt;

    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Column(name = "last_error", length = 1024)
    private String lastError;
}
```

#### Semántica de los campos

| Campo | Tipo Java | Descripción |
|---|---|---|
| `id` | `UUID` | PK generada con `UUID.randomUUID()` por el `DomainEventHandler` al insertar. No usa `@GeneratedValue`. |
| `destination` | `String` (max 255) | Para RabbitMQ: nombre del exchange. Para Kafka: nombre del topic. |
| `routing_key` | `String` (max 255, nullable) | Para RabbitMQ: routing key del mensaje. Para Kafka: partition key. Puede ser null. |
| `event_type` | `String` (max 512) | FQN simple de la clase `IntegrationEvent` (e.g. `ProductActivatedIntegrationEvent`). Solo para trazabilidad — el relay no lo usa para despachar. |
| `payload` | `TEXT` | JSON completo del `EventEnvelope<IntegrationEvent>` ya serializado. El relay lo envía verbatim al broker. |
| `created_at` | `Instant` | Momento de inserción. Usado para orden FIFO en `findPending`. |
| `published_at` | `Instant` (nullable) | `null` = pendiente. Distinto de `null` = publicado. El relay lo setea tras éxito del broker. |
| `attempts` | `int` | Contador de intentos fallidos. Default 0. Se incrementa en cada excepción del relay. **No hay un umbral de abandono** generado — la fila queda pendiente indefinidamente. |
| `last_error` | `String` (max 1024, nullable) | Mensaje truncado de la última excepción. Solo informativo. |

> **No hay estado `FAILED` ni columna `status`.** A diferencia de lo que sugiere `system-yaml-reference.md`,
> el generador real no produce una columna `status`. Una fila está pendiente si `published_at IS NULL`
> y publicada si `published_at IS NOT NULL`. El contador `attempts` registra los reintentos fallidos
> pero no marca la fila como abandonada.

---

### 4.2 `OutboxEventJpaRepository.java` — repositorio

**Ruta:** `src/main/java/{pkg}/shared/infrastructure/outbox/OutboxEventJpaRepository.java`
**Template:** `templates/shared/outbox/OutboxEventJpaRepository.java.ejs`

#### Sin `outboxRetentionDays`

```java
public interface OutboxEventJpaRepository extends JpaRepository<OutboxEventJpa, UUID> {

    @Query("select o from OutboxEventJpa o where o.publishedAt is null order by o.createdAt asc")
    List<OutboxEventJpa> findPending(Pageable pageable);
}
```

Solo tiene un método custom. El relay pasa `PageRequest.of(0, BATCH_SIZE)` donde
`BATCH_SIZE = 100`. La query JPQL es equivalente a:

```sql
SELECT * FROM outbox_event WHERE published_at IS NULL ORDER BY created_at ASC LIMIT 100;
```

#### Con `outboxRetentionDays` (purge habilitado)

```java
public interface OutboxEventJpaRepository extends JpaRepository<OutboxEventJpa, UUID> {

    @Query("select o from OutboxEventJpa o where o.publishedAt is null order by o.createdAt asc")
    List<OutboxEventJpa> findPending(Pageable pageable);

    @Modifying
    @Query("delete from OutboxEventJpa o where o.publishedAt is not null and o.publishedAt < :cutoff")
    int deletePublishedBefore(@Param("cutoff") Instant cutoff);
}
```

`deletePublishedBefore` es un DELETE JPQL en bulk. Requiere `@Modifying` (Spring Data)
y `@Param` para el binding del parámetro. Solo se genera cuando `purgeEnabled = true`;
los imports de `@Modifying`, `@Param` e `Instant` son también condicionales.

La query SQL equivalente:

```sql
DELETE FROM outbox_event
WHERE published_at IS NOT NULL
  AND published_at < :cutoff;
```

---

### 4.3 `OutboxRelay.java` — relay programado

**Ruta:** `src/main/java/{pkg}/shared/infrastructure/outbox/OutboxRelay.java`
**Template:** `templates/shared/outbox/OutboxRelayRabbit.java.ejs` o `OutboxRelayKafka.java.ejs`
(seleccionado por el generador según `config.broker`)

#### Variante RabbitMQ

```java
@Component
public class OutboxRelay {

    private static final int BATCH_SIZE = 100;

    private final OutboxEventJpaRepository outboxRepository;
    private final RabbitTemplate rabbitTemplate;

    // Solo presente si outboxRetentionDays está configurado:
    @Value("${outbox.purge.retention-days:7}")
    private int retentionDays;

    @Scheduled(fixedDelayString = "${outbox.relay.fixed-delay-ms:1000}")
    @Transactional
    public void relay() {
        List<OutboxEventJpa> pending = outboxRepository.findPending(PageRequest.of(0, BATCH_SIZE));
        if (pending.isEmpty()) return;

        for (OutboxEventJpa row : pending) {
            try {
                MessageProperties props = new MessageProperties();
                props.setContentType(MessageProperties.CONTENT_TYPE_JSON);
                props.setMessageId(row.getId().toString());
                Message message = MessageBuilder
                    .withBody(row.getPayload().getBytes(StandardCharsets.UTF_8))
                    .andProperties(props)
                    .build();

                rabbitTemplate.send(row.getDestination(), row.getRoutingKey(), message);

                row.setPublishedAt(Instant.now());
                outboxRepository.save(row);
            } catch (RuntimeException ex) {
                row.setAttempts(row.getAttempts() + 1);
                row.setLastError(truncate(ex.getMessage(), 1024));
                outboxRepository.save(row);
                log.warn("Outbox relay failed for id={} (attempt {}): {}",
                    row.getId(), row.getAttempts(), ex.getMessage());
            }
        }
    }

    // Solo presente si outboxRetentionDays está configurado:
    @Scheduled(cron = "${outbox.purge.cron:0 0 3 * * *}")
    @Transactional
    public void purge() {
        Instant cutoff = Instant.now().minus(retentionDays, ChronoUnit.DAYS);
        int deleted = outboxRepository.deletePublishedBefore(cutoff);
        if (deleted > 0) {
            log.info("Outbox purge: deleted {} published rows older than {} days", deleted, retentionDays);
        }
    }
}
```

#### Variante Kafka

```java
@Component
public class OutboxRelay {

    private static final int BATCH_SIZE = 100;

    private final OutboxEventJpaRepository outboxRepository;
    private final KafkaTemplate<String, String> kafkaTemplate;

    // Solo presente si outboxRetentionDays está configurado:
    @Value("${outbox.purge.retention-days:7}")
    private int retentionDays;

    @Scheduled(fixedDelayString = "${outbox.relay.fixed-delay-ms:1000}")
    @Transactional
    public void relay() {
        List<OutboxEventJpa> pending = outboxRepository.findPending(PageRequest.of(0, BATCH_SIZE));
        if (pending.isEmpty()) return;

        for (OutboxEventJpa row : pending) {
            try {
                kafkaTemplate.send(row.getDestination(), row.getRoutingKey(), row.getPayload()).get();
                row.setPublishedAt(Instant.now());
                outboxRepository.save(row);
            } catch (Exception ex) {
                row.setAttempts(row.getAttempts() + 1);
                row.setLastError(truncate(ex.getMessage(), 1024));
                outboxRepository.save(row);
                log.warn("Outbox relay failed for id={} (attempt {}): {}",
                    row.getId(), row.getAttempts(), ex.getMessage());
            }
        }
    }

    // Solo presente si outboxRetentionDays está configurado:
    @Scheduled(cron = "${outbox.purge.cron:0 0 3 * * *}")
    @Transactional
    public void purge() {
        Instant cutoff = Instant.now().minus(retentionDays, ChronoUnit.DAYS);
        int deleted = outboxRepository.deletePublishedBefore(cutoff);
        if (deleted > 0) {
            log.info("Outbox purge: deleted {} published rows older than {} days", deleted, retentionDays);
        }
    }
}
```

#### Diferencias entre variantes

| Aspecto | RabbitMQ | Kafka |
|---|---|---|
| Dependencia inyectada | `RabbitTemplate` | `KafkaTemplate<String, String>` |
| Método de envío | `rabbitTemplate.send(exchange, routingKey, Message)` | `kafkaTemplate.send(topic, partitionKey, payload).get()` |
| Tipo de `payload` | Construye `Message` con `MessageBuilder` (bytes UTF-8, `Content-Type: application/json`, `MessageId = row.id`) | Envía el JSON string directamente |
| Bloqueo | No bloquea explícitamente (send síncrono en AMQP) | `.get()` bloquea hasta confirmación del broker |
| `catch` | `RuntimeException` | `Exception` (por el checked `InterruptedException` de `Future.get()`) |
| `row.routingKey` | Routing key de RabbitMQ | Partition key de Kafka (puede ser null) |
| `row.destination` | Nombre del exchange | Nombre del topic |

#### Método `purge()` — retención de filas publicadas

Cuando `outboxRetentionDays` está configurado, **ambas variantes** generan idéntico
código de purga (la lógica es agnóstica al broker):

```java
@Scheduled(cron = "${outbox.purge.cron:0 0 3 * * *}")
@Transactional
public void purge() {
    Instant cutoff = Instant.now().minus(retentionDays, ChronoUnit.DAYS);
    int deleted = outboxRepository.deletePublishedBefore(cutoff);
    if (deleted > 0) {
        log.info("Outbox purge: deleted {} published rows older than {} days", deleted, retentionDays);
    }
}
```

| Propiedad configurable | Default generado | Descripción |
|---|---|---|
| `outbox.purge.cron` | `0 0 3 * * *` | Expresión cron de Spring — por defecto a las 03:00 cada día |
| `outbox.purge.retention-days` | Valor de `outboxRetentionDays` en el YAML | Días de retención para filas publicadas |

El valor por defecto del `@Value` (`${outbox.purge.retention-days:<N>}`) se rellena
automáticamente con el valor declarado en `system.yaml`. Ambos pueden sobreescribirse
en `application.yaml` en cada entorno sin regenerar código.

La purga es **idempotente y segura con múltiples instancias**: si varias instancias
ejecutan `purge()` simultáneamente, cada DELETE elimina las filas que encuentra;
la segunda instancia simplemente borra 0 filas. No se requiere locking distribuido.

#### `@Scheduled` y `@Transactional`

El relay tiene `@Transactional`. Esto significa que el UPDATE de `published_at` / `attempts`
ocurre en una transacción distinta a la que insertó la fila. Si el relay falla a mitad del
batch, las filas ya marcadas (`publishedAt != null`) no se revertirán porque cada `save(row)`
es parte de la misma transacción del relay completo. Si la transacción del relay rollbackea,
todas las actualizaciones del batch se deshacen y el batch se reprocesará completo en el
siguiente ciclo.

El delay entre ciclos es configurable vía `${outbox.relay.fixed-delay-ms:1000}`. El default
es 1000ms (1 segundo). `fixedDelay` (no `fixedRate`) significa que el temporizador empieza
**después** de que termina el método, no antes. Si el relay tarda 500ms, el siguiente ciclo
empieza 1000ms después de que termina (a los 1500ms del inicio del ciclo anterior).

---

### 4.4 `{BcPascal}DomainEventHandler.java` — variante outbox

**Ruta:** `src/main/java/{pkg}/{bc}/application/usecases/{BcPascal}DomainEventHandler.java`
**Template:** `templates/messaging/DomainEventHandler.java.ejs` (rama `outboxEnabled`)

Con `outbox: true`, el generador produce un handler radicalmente diferente al que genera
sin outbox. Las diferencias son:

| Aspecto | Sin outbox | Con outbox |
|---|---|---|
| Anotación | `@TransactionalEventListener(phase = AFTER_COMMIT)` | `@EventListener` (ordinario) |
| Dependencias | `MessageBroker` | `OutboxEventJpaRepository` + `ObjectMapper` |
| Qué hace | Llama a `MessageBroker.publishXxx()` | Inserta fila en `outbox_event` |
| Cuándo corre | Después del COMMIT | Dentro de la transacción (síncrono) |
| `@Value` bindings (RabbitMQ) | Ninguno | `${exchanges.{bc}:{bc}.events}` y `${routing-keys.{event}:{bc}.{event}}` |
| `@Value` bindings (Kafka) | Ninguno | `${topics.{event}}` por evento |

El template ramifica los bindings según `broker`. Un mismo `{bc}.yaml` genera código
correcto con independencia del broker configurado.

#### Código generado con `outbox: true` + `broker: rabbitmq`

```java
@ApplicationComponent
public class CatalogDomainEventHandler {

    private final OutboxEventJpaRepository outboxRepository;
    private final ObjectMapper objectMapper;

    @Value("${exchanges.catalog:catalog.events}")
    private String exchange;

    @Value("${routing-keys.product-activated:catalog.product-activated}")
    private String productActivatedRoutingKey;

    public CatalogDomainEventHandler(OutboxEventJpaRepository outboxRepository, ObjectMapper objectMapper) {
        this.outboxRepository = outboxRepository;
        this.objectMapper = objectMapper;
    }

    @EventListener
    public void onProductActivatedEvent(ProductActivatedEvent event) {
        ProductActivatedIntegrationEvent integrationEvent = new ProductActivatedIntegrationEvent(
                event.metadata(),
                event.productId(),
                event.productName(),
                event.price()
        );
        EventEnvelope<ProductActivatedIntegrationEvent> envelope = EventEnvelope.of(
            productActivatedRoutingKey,
            integrationEvent,
            MDC.get("correlationId")
        );
        try {
            outboxRepository.save(OutboxEventJpa.builder()
                .id(UUID.randomUUID())
                .destination(exchange)
                .routingKey(productActivatedRoutingKey)
                .eventType("ProductActivatedIntegrationEvent")
                .payload(objectMapper.writeValueAsString(envelope))
                .createdAt(Instant.now())
                .attempts(0)
                .build());
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize ProductActivatedIntegrationEvent", e);
        }
    }
}
```

#### Código generado con `outbox: true` + `broker: kafka`

```java
@ApplicationComponent
public class CatalogDomainEventHandler {

    private final OutboxEventJpaRepository outboxRepository;
    private final ObjectMapper objectMapper;

    @Value("${topics.product-activated}")
    private String productActivatedTopic;

    public CatalogDomainEventHandler(OutboxEventJpaRepository outboxRepository, ObjectMapper objectMapper) {
        this.outboxRepository = outboxRepository;
        this.objectMapper = objectMapper;
    }

    @EventListener
    public void onProductActivatedEvent(ProductActivatedEvent event) {
        ProductActivatedIntegrationEvent integrationEvent = new ProductActivatedIntegrationEvent(
                event.metadata(),
                event.productId(),
                event.productName(),
                event.price()
        );
        EventEnvelope<ProductActivatedIntegrationEvent> envelope = EventEnvelope.of(
            productActivatedTopic,
            integrationEvent,
            MDC.get("correlationId")
        );
        try {
            outboxRepository.save(OutboxEventJpa.builder()
                .id(UUID.randomUUID())
                .destination(productActivatedTopic)
                .routingKey(null)
                .eventType("ProductActivatedIntegrationEvent")
                .payload(objectMapper.writeValueAsString(envelope))
                .createdAt(Instant.now())
                .attempts(0)
                .build());
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize ProductActivatedIntegrationEvent", e);
        }
    }
}
```

#### Los `@Value` bindings según broker

**RabbitMQ** — un `exchange` compartido por BC + un `routingKey` por evento:
```java
@Value("${exchanges.catalog:catalog.events}")
private String exchange;

@Value("${routing-keys.product-activated:catalog.product-activated}")
private String productActivatedRoutingKey;
```
`rabbitmq.yaml` generado declara los bloques `exchanges` y `routing-keys`, por lo que
los `@Value` se resuelven correctamente desde el archivo de parámetros.

**Kafka** — un `topic` por evento, sin `exchange` compartido:
```java
@Value("${topics.product-activated}")
private String productActivatedTopic;
```
`kafka.yaml` generado declara el bloque `topics`, por lo que el `@Value` se resuelve
correctamente. El campo `routingKey` en la fila outbox se guarda como `null`;
`OutboxRelayKafka` lo usa como partition key, y `null` delega en el particionador
por defecto de Kafka.

#### `EventEnvelope` — la estructura del payload serializado

El JSON insertado en `outbox_event.payload` tiene esta estructura:

```json
{
  "metadata": {
    "eventId": "a3f2...",
    "eventType": "catalog.product-activated",
    "timestamp": "2026-05-04T10:30:00",
    "correlationId": "abc-123",
    "source": "canasta-shop-api"
  },
  "data": {
    "metadata": { "eventId": "...", "eventType": "...", ... },
    "productId": "uuid-value",
    "productName": "Widget Pro",
    "price": 29.99
  }
}
```

El `EventEnvelope.of(routingKey, integrationEvent, correlationId)` usa el `routingKey`
como `eventType` en los metadatos del envelope. El `correlationId` se toma del MDC de SLF4J
(`MDC.get("correlationId")`), que puede ser null si no hay correlación activa.

---

## 5. Migración Flyway generada

**Ruta:** `src/main/resources/db/migration/V1__reliability.sql`
**Template:** `templates/base/resources/db/migration/V1__reliability.sql.ejs`

El mismo archivo sirve para outbox y para idempotencia de consumidores. Solo se generan
las secciones correspondientes a las flags activadas.

### DDL con `outbox: true`

```sql
CREATE TABLE IF NOT EXISTS outbox_event (
    id           UUID         NOT NULL,
    destination  VARCHAR(255) NOT NULL,
    routing_key  VARCHAR(255),
    event_type   VARCHAR(512) NOT NULL,
    payload      TEXT         NOT NULL,
    created_at   TIMESTAMP    NOT NULL,
    published_at TIMESTAMP,
    attempts     INTEGER      NOT NULL DEFAULT 0,
    last_error   VARCHAR(1024),
    CONSTRAINT pk_outbox_event PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_event (published_at, created_at);
```

#### Notas del DDL

- `id UUID NOT NULL` — sin `DEFAULT gen_random_uuid()`. La aplicación genera el UUID en
  `OutboxEventJpa.builder().id(UUID.randomUUID())`. Esto es intencional: el UUID se genera
  en la capa de aplicación, no en la base de datos, lo que facilita el tracing.
- `routing_key VARCHAR(255)` — nullable. Para Kafka puede ser null si el evento no tiene
  `broker.partitionKey` declarado.
- `payload TEXT` — sin restricción `JSONB`. El generador usa `TEXT` para compatibilidad
  con MySQL y H2 (PostgreSQL soportaría `JSONB` pero el template usa el tipo más portable).
- `published_at TIMESTAMP` — nullable. `IS NULL` = pendiente; `IS NOT NULL` = publicado.
- El índice `idx_outbox_pending ON outbox_event (published_at, created_at)` optimiza
  la query `findPending` que filtra `WHERE published_at IS NULL ORDER BY created_at ASC`.

### DDL con `outbox: true` + `consumerIdempotency: true`

Cuando ambas flags están activadas, el mismo archivo V1 incluye ambas tablas:

```sql
CREATE TABLE IF NOT EXISTS outbox_event ( ... );
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_event (published_at, created_at);

CREATE TABLE IF NOT EXISTS processed_event (
    handler_id   VARCHAR(512) NOT NULL,
    event_id     VARCHAR(64)  NOT NULL,
    processed_at TIMESTAMP    NOT NULL,
    CONSTRAINT pk_processed_event PRIMARY KEY (handler_id, event_id)
);
```

Flyway activa si cualquiera de estas condiciones es verdadera:
- `outbox: true`
- `consumerIdempotency: true`
- Existen proyecciones persistentes (`projections[].persistent: true`)
- Algún use case declara `idempotency: true`
- Algún use case declara `async.mode: jobTracking`

---

## 6. Diferencias según el broker

| Aspecto | Broker `rabbitmq` (elegido en CLI) | Broker `kafka` (elegido en CLI) |
|---|---|---|
| `OutboxRelay.java` generado | `OutboxRelayRabbit.java.ejs` | `OutboxRelayKafka.java.ejs` |
| Dependencia inyectada en relay | `RabbitTemplate` | `KafkaTemplate<String, String>` |
| `row.destination` → | Exchange RabbitMQ | Topic Kafka |
| `row.routing_key` → | Routing key AMQP | Partition key Kafka (puede ser null) |
| Envío RabbitMQ | `rabbitTemplate.send(exchange, routingKey, Message)` con `Content-Type: application/json` y `MessageId` | — |
| Envío Kafka | — | `kafkaTemplate.send(topic, partitionKey, payload).get()` (bloqueante) |
| `@Value` en handler (campo compartido) | `${exchanges.{bc}:{bc}.events}` → resuelto desde `rabbitmq.yaml` | No hay campo de exchange — cada evento tiene su propio topic |
| `@Value` en handler (por evento) | `${routing-keys.{event}:{bc}.{event}}` → resuelto desde `rabbitmq.yaml` | `${topics.{event}}` → resuelto desde `kafka.yaml` |
| `routingKey` en fila outbox | Routing key del evento | `null` (partition key delegada al particionador por defecto) |

---

## 7. Efecto en `build.gradle` y `Application.java`

### `Application.java`

Con `outbox: true`, la clase principal añade `@EnableScheduling`:

```java
@SpringBootApplication
@EnableJpaAuditing
@EnableFeignClients
@EnableScheduling          // ← solo cuando outbox: true
public class CanastaShopApplication {
    public static void main(String[] args) {
        SpringApplication.run(CanastaShopApplication.class, args);
    }
}
```

Sin `@EnableScheduling`, el `@Scheduled` del `OutboxRelay` nunca se ejecutaría.

### `build.gradle`

El outbox activa Flyway. La condición exacta es:

```
flywayEnabled = outboxEnabled
             || consumerIdempotencyEnabled
             || persistentProjectionsPresent
             || requestIdempotencyPresent
             || asyncJobPresent
```

Cuando `flywayEnabled` es `true`:

```groovy
implementation 'org.flywaydb:flyway-core'
// Para PostgreSQL:
implementation 'org.flywaydb:flyway-database-postgresql'
// Para MySQL:
implementation 'org.flywaydb:flyway-mysql'
```

No se añade ninguna dependencia específica de "outbox" — el outbox se apoya en las
dependencias JPA y del broker que ya están presentes.

---

## 8. Limitaciones conocidas del generador

### No hay umbral de abandono

El relay no tiene un máximo de reintentos. Una fila con `published_at IS NULL`
permanecerá pendiente indefinidamente, incrementando `attempts` en cada fallo.
No se genera ningún mecanismo de Dead Letter para el outbox. Si el broker está
permanentemente caído, el relay seguirá reintentando para siempre.

### El relay es un singleton sin bloqueo distribuido

Si se despliegan múltiples instancias de la aplicación, varias instancias del relay
ejecutarán `findPending()` simultáneamente. No hay `SELECT FOR UPDATE SKIP LOCKED`
ni ningún mecanismo de locking. Múltiples instancias pueden leer las mismas filas
y enviar el mismo mensaje al broker varias veces. Los consumidores deben ser
idempotentes (`consumerIdempotency: true`) para tolerar esto.

### La tabla `outbox_event` crece sin límite si no se configura `outboxRetentionDays`

Cuando `outboxRetentionDays` está ausente, el generador no emite ningún mecanismo
de purga. Las filas con `published_at IS NOT NULL` se acumulan indefinidamente.
Para activar la purga automática, añadir `outboxRetentionDays: <N>` en
`system.yaml#/infrastructure/reliability` (ver [§2](#2-cómo-activarlo)).

Cuando la purga está activa, solo se eliminan filas **ya publicadas**
(`published_at IS NOT NULL`). Las filas pendientes nunca se purgan, independientemente
de su antigüedad o número de intentos.

---

## 9. Comparativa: con vs sin `outbox: true`

| Aspecto | Sin outbox | Con outbox |
|---|---|---|
| Garantía de entrega | At-most-once (si la app falla entre COMMIT y publish) | At-least-once (el relay reintenta hasta que el broker acepta) |
| Anotación en `DomainEventHandler` | `@TransactionalEventListener(AFTER_COMMIT)` | `@EventListener` (síncrono, inside transaction) |
| Dependencia en handler | `MessageBroker` | `OutboxEventJpaRepository` + `ObjectMapper` |
| Latencia de publicación | ~0ms (en el COMMIT) | ~1000ms (próximo ciclo del relay, configurable) |
| Tabla de BD adicional | No | Sí — `outbox_event` |
| Migración Flyway | Solo si hay otras flags | Sí — `V1__reliability.sql` |
| `@EnableScheduling` | No | Sí |
| Flyway en `build.gradle` | Solo si hay otras flags | Sí |
| Riesgo de duplicados al consumidor | Bajo (pero posible) | Mayor — múltiples instancias del relay pueden duplicar |
| `MessageBroker` / adaptador Kafka/Rabbit | Generado (usado por handler) | Generado pero **no usado** por el handler (el relay llama directamente al template) |
