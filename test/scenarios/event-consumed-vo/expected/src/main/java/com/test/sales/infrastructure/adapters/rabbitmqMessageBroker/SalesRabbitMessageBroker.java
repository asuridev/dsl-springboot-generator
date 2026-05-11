package com.test.sales.infrastructure.adapters.rabbitmqMessageBroker;

import com.test.sales.application.events.OrderPlacedIntegrationEvent;
import com.test.sales.application.ports.MessageBroker;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import org.slf4j.MDC;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * SalesRabbitMessageBroker — RabbitMQ adapter implementing {@link MessageBroker}.
 *
 * Exchange and routing keys are resolved at runtime from parameters/{env}/rabbitmq.yaml
 * via @Value bindings, so no hardcoded strings are present here.
 * derived_from: domainEvents.published (all entries)
 */
@Component("salesRabbitMessageBroker")
public class SalesRabbitMessageBroker implements MessageBroker {

    @Value("${exchanges.sales}")
    private String exchange;

    @Value("${routing-keys.order-placed}")
    private String orderPlacedRoutingKey;

    private final RabbitTemplate rabbitTemplate;

    public SalesRabbitMessageBroker(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    @Override
    public void publishOrderPlacedIntegrationEvent(OrderPlacedIntegrationEvent event) {
        EventEnvelope<OrderPlacedIntegrationEvent> envelope = EventEnvelope.of(
            orderPlacedRoutingKey,
            event,
            MDC.get("correlationId")
        );

        rabbitTemplate.convertAndSend(exchange, orderPlacedRoutingKey, envelope);
    }
}
