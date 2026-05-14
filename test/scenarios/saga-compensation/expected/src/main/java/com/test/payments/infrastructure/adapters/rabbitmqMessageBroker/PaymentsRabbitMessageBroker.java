package com.test.payments.infrastructure.adapters.rabbitmqMessageBroker;

import com.test.payments.application.events.PaymentApprovedIntegrationEvent;
import com.test.payments.application.events.PaymentFailedIntegrationEvent;
import com.test.payments.application.ports.MessageBroker;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import org.slf4j.MDC;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * PaymentsRabbitMessageBroker — RabbitMQ adapter implementing {@link MessageBroker}.
 *
 * Exchange and routing keys are resolved at runtime from parameters/{env}/rabbitmq.yaml
 * via @Value bindings, so no hardcoded strings are present here.
 * derived_from: domainEvents.published (all entries)
 */
@Component("paymentsRabbitMessageBroker")
public class PaymentsRabbitMessageBroker implements MessageBroker {

    @Value("${exchanges.payments}")
    private String exchange;

    @Value("${routing-keys.payment-approved}")
    private String paymentApprovedRoutingKey;

    @Value("${routing-keys.payment-failed}")
    private String paymentFailedRoutingKey;

    private final RabbitTemplate rabbitTemplate;

    public PaymentsRabbitMessageBroker(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    @Override
    public void publishPaymentApprovedIntegrationEvent(PaymentApprovedIntegrationEvent event) {
        EventEnvelope<PaymentApprovedIntegrationEvent> envelope = EventEnvelope.of(
            paymentApprovedRoutingKey,
            event,
            MDC.get("correlationId")
        );

        rabbitTemplate.convertAndSend(exchange, paymentApprovedRoutingKey, envelope);
    }

    @Override
    public void publishPaymentFailedIntegrationEvent(PaymentFailedIntegrationEvent event) {
        EventEnvelope<PaymentFailedIntegrationEvent> envelope = EventEnvelope.of(
            paymentFailedRoutingKey,
            event,
            MDC.get("correlationId")
        );

        rabbitTemplate.convertAndSend(exchange, paymentFailedRoutingKey, envelope);
    }
}
