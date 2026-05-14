package com.test.orders.infrastructure.adapters.rabbitmqMessageBroker;

import com.test.orders.application.events.OrderPlacedIntegrationEvent;
import com.test.orders.application.ports.MessageBroker;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import org.slf4j.MDC;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * OrdersRabbitMessageBroker — RabbitMQ adapter implementing {@link MessageBroker}.
 *
 * Exchange and routing keys are resolved at runtime from parameters/{env}/rabbitmq.yaml
 * via @Value bindings, so no hardcoded strings are present here.
 * derived_from: domainEvents.published (all entries)
 */
@Component("ordersRabbitMessageBroker")
public class OrdersRabbitMessageBroker implements MessageBroker {

    @Value("${exchanges.orders}")
    private String exchange;

    @Value("${routing-keys.order-placed}")
    private String orderPlacedRoutingKey;

    private final RabbitTemplate rabbitTemplate;

    public OrdersRabbitMessageBroker(RabbitTemplate rabbitTemplate) {
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
