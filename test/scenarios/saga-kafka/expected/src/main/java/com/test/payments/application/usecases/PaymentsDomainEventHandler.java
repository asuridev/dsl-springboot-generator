package com.test.payments.application.usecases;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.test.payments.application.events.PaymentApprovedIntegrationEvent;
import com.test.payments.application.events.PaymentFailedIntegrationEvent;
import com.test.payments.domain.events.PaymentApprovedEvent;
import com.test.payments.domain.events.PaymentFailedEvent;
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
 * PaymentsDomainEventHandler — Domain Event Bridge
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
public class PaymentsDomainEventHandler {

    private final OutboxEventJpaRepository outboxRepository;
    private final ObjectMapper objectMapper;

    @Value("${topics.payment-approved}")
    private String paymentApprovedTopic;

    @Value("${topics.payment-failed}")
    private String paymentFailedTopic;

    public PaymentsDomainEventHandler(OutboxEventJpaRepository outboxRepository, ObjectMapper objectMapper) {
        this.outboxRepository = outboxRepository;
        this.objectMapper = objectMapper;
    }

    /**
     * Handles {@link PaymentApprovedEvent} synchronously inside the publishing transaction
     * and persists an outbox row for asynchronous broker delivery.
     * derived_from: domainEvents.published.PaymentApproved
     */
    @EventListener
    @SagaStep(saga = "PaymentSaga", order = 1, event = "PaymentApproved", role = SagaStep.Role.SUCCESS)
    public void onPaymentApprovedEvent(PaymentApprovedEvent event) {
        PaymentApprovedIntegrationEvent integrationEvent = new PaymentApprovedIntegrationEvent(
            event.metadata(),
            event.orderId()
        );
        EventEnvelope<PaymentApprovedIntegrationEvent> envelope = EventEnvelope.of(
            paymentApprovedTopic,
            integrationEvent,
            MDC.get("correlationId")
        );
        try {
            outboxRepository.save(
                OutboxEventJpa.builder()
                    .id(UUID.randomUUID())
                    .destination(paymentApprovedTopic)
                    .routingKey(null)
                    .eventType("PaymentApprovedIntegrationEvent")
                    .payload(objectMapper.writeValueAsString(envelope))
                    .createdAt(Instant.now())
                    .attempts(0)
                    .build()
            );
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize PaymentApprovedIntegrationEvent", e);
        }
    }

    /**
     * Handles {@link PaymentFailedEvent} synchronously inside the publishing transaction
     * and persists an outbox row for asynchronous broker delivery.
     * derived_from: domainEvents.published.PaymentFailed
     */
    @EventListener
    @SagaStep(saga = "PaymentSaga", order = 1, event = "PaymentFailed", role = SagaStep.Role.FAILURE)
    public void onPaymentFailedEvent(PaymentFailedEvent event) {
        PaymentFailedIntegrationEvent integrationEvent = new PaymentFailedIntegrationEvent(
            event.metadata(),
            event.orderId()
        );
        EventEnvelope<PaymentFailedIntegrationEvent> envelope = EventEnvelope.of(
            paymentFailedTopic,
            integrationEvent,
            MDC.get("correlationId")
        );
        try {
            outboxRepository.save(
                OutboxEventJpa.builder()
                    .id(UUID.randomUUID())
                    .destination(paymentFailedTopic)
                    .routingKey(null)
                    .eventType("PaymentFailedIntegrationEvent")
                    .payload(objectMapper.writeValueAsString(envelope))
                    .createdAt(Instant.now())
                    .attempts(0)
                    .build()
            );
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize PaymentFailedIntegrationEvent", e);
        }
    }
}
