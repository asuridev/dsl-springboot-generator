package com.test.catalog.application.usecases;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.test.catalog.application.events.ProductActivatedIntegrationEvent;
import com.test.catalog.domain.events.ProductActivatedEvent;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import com.test.shared.infrastructure.outbox.OutboxEventJpa;
import com.test.shared.infrastructure.outbox.OutboxEventJpaRepository;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;

/**
 * CatalogDomainEventHandler — Domain Event Bridge
 *

 * derived_from: system.yaml#/infrastructure/reliability/outbox
 *
 * Outbox mode is enabled. Each domain event is captured by a regular
 * {@code @EventListener} (synchronous, runs inside the publishing transaction)
 * and persisted as a row in {@code outbox_event}. The shared {@code OutboxRelay}
 * scheduler forwards the row to the broker after the transaction commits.
 *
 * This guarantees atomicity between aggregate persistence and event capture:
 * if the database transaction rolls back, the outbox row is rolled back too.

 */
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

    /**
     * Handles {@link ProductActivatedEvent} synchronously inside the publishing transaction
     * and persists an outbox row for asynchronous broker delivery.
     * derived_from: domainEvents.published.ProductActivated
     */
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
            outboxRepository.save(
                OutboxEventJpa.builder()
                    .id(UUID.randomUUID())
                    .destination(exchange)
                    .routingKey(productActivatedRoutingKey)
                    .eventType("ProductActivatedIntegrationEvent")
                    .payload(objectMapper.writeValueAsString(envelope))
                    .createdAt(Instant.now())
                    .attempts(0)
                    .build()
            );
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize ProductActivatedIntegrationEvent", e);
        }
    }
}
