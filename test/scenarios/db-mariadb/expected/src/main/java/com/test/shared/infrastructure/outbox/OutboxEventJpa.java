// derived_from: system.yaml#/infrastructure/reliability/outbox
package com.test.shared.infrastructure.outbox;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Transactional Outbox row.
 *
 * Producers (DomainEventHandler) persist one row per integration event in the
 * same database transaction that mutates the aggregate. The {@code OutboxRelay}
 * scheduled poller reads pending rows ({@code publishedAt IS NULL}) and forwards
 * them to the broker. Once a broker accepts the message, the row is marked as
 * published.
 *
 * derived_from: system.yaml#/infrastructure/reliability/outbox
 */
@Entity
@Table(name = "outbox_event")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class OutboxEventJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
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

    /** Pre-serialized {@code EventEnvelope&lt;IntegrationEvent&gt;} as JSON. */
    @Column(name = "payload", nullable = false, columnDefinition = "LONGTEXT")
    private String payload;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /** Set when the broker has accepted the message. */
    @Column(name = "published_at")
    private Instant publishedAt;

    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Column(name = "last_error", length = 1024)
    private String lastError;
}
