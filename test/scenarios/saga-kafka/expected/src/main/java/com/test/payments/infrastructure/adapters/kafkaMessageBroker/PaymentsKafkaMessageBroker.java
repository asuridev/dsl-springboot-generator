package com.test.payments.infrastructure.adapters.kafkaMessageBroker;

import com.test.payments.application.events.PaymentApprovedIntegrationEvent;
import com.test.payments.application.events.PaymentFailedIntegrationEvent;
import com.test.payments.application.ports.MessageBroker;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

/**
 * PaymentsKafkaMessageBroker — Kafka adapter implementing {@link MessageBroker}.
 *
 * Topics are resolved at runtime from parameters/{env}/kafka.yaml via @Value bindings.
 * derived_from: domainEvents.published (all entries)
 */
@Component("paymentsKafkaMessageBroker")
public class PaymentsKafkaMessageBroker implements MessageBroker {

    @Value("${topics.payment-approved}")
    private String paymentApprovedTopic;

    @Value("${topics.payment-failed}")
    private String paymentFailedTopic;

    private final KafkaTemplate<String, Object> kafkaTemplate;

    public PaymentsKafkaMessageBroker(KafkaTemplate<String, Object> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    @Override
    public void publishPaymentApprovedIntegrationEvent(PaymentApprovedIntegrationEvent event) {
        EventEnvelope<PaymentApprovedIntegrationEvent> envelope = EventEnvelope.of(
            paymentApprovedTopic,
            event,
            MDC.get("correlationId")
        );

        kafkaTemplate.send(paymentApprovedTopic, envelope);
    }

    @Override
    public void publishPaymentFailedIntegrationEvent(PaymentFailedIntegrationEvent event) {
        EventEnvelope<PaymentFailedIntegrationEvent> envelope = EventEnvelope.of(
            paymentFailedTopic,
            event,
            MDC.get("correlationId")
        );

        kafkaTemplate.send(paymentFailedTopic, envelope);
    }
}
