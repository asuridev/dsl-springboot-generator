package com.test.orders.application.usecases;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.test.orders.application.events.OrderPlacedIntegrationEvent;
import com.test.orders.domain.events.OrderPlacedEvent;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.SagaStep;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import com.test.shared.infrastructure.outbox.OutboxEventJpa;
import com.test.shared.infrastructure.outbox.OutboxEventJpaRepository;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;

/**
 * OrdersDomainEventHandler — Domain Event Bridge
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
public class OrdersDomainEventHandler {

    private final OutboxEventJpaRepository outboxRepository;
    private final ObjectMapper objectMapper;

    @Value("${topics.order-placed}")
    private String orderPlacedTopic;

    public OrdersDomainEventHandler(OutboxEventJpaRepository outboxRepository, ObjectMapper objectMapper) {
        this.outboxRepository = outboxRepository;
        this.objectMapper = objectMapper;
    }

    /**
     * Handles {@link OrderPlacedEvent} synchronously inside the publishing transaction
     * and persists an outbox row for asynchronous broker delivery.
     * derived_from: domainEvents.published.OrderPlaced
     */
    @EventListener
    @SagaStep(saga = "PaymentSaga", order = 0, event = "OrderPlaced", role = SagaStep.Role.TRIGGER)
    public void onOrderPlacedEvent(OrderPlacedEvent event) {
        OrderPlacedIntegrationEvent integrationEvent = new OrderPlacedIntegrationEvent(
            event.metadata(),
            event.orderId(),
            event.customerId()
        );
        EventEnvelope<OrderPlacedIntegrationEvent> envelope = EventEnvelope.of(
            orderPlacedTopic,
            integrationEvent,
            MDC.get("correlationId")
        );
        try {
            outboxRepository.save(
                OutboxEventJpa.builder()
                    .id(UUID.randomUUID())
                    .destination(orderPlacedTopic)
                    .routingKey(null)
                    .eventType("OrderPlacedIntegrationEvent")
                    .payload(objectMapper.writeValueAsString(envelope))
                    .createdAt(Instant.now())
                    .attempts(0)
                    .build()
            );
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize OrderPlacedIntegrationEvent", e);
        }
    }
}
