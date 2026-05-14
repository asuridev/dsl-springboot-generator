package com.test.catalog.infrastructure.adapters.rabbitmqMessageBroker;

import com.test.catalog.application.events.ProductActivatedIntegrationEvent;
import com.test.catalog.application.ports.MessageBroker;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import org.slf4j.MDC;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * CatalogRabbitMessageBroker — RabbitMQ adapter implementing {@link MessageBroker}.
 *
 * Exchange and routing keys are resolved at runtime from parameters/{env}/rabbitmq.yaml
 * via @Value bindings, so no hardcoded strings are present here.
 * derived_from: domainEvents.published (all entries)
 */
@Component("catalogRabbitMessageBroker")
public class CatalogRabbitMessageBroker implements MessageBroker {

    @Value("${exchanges.catalog}")
    private String exchange;

    @Value("${routing-keys.product-activated}")
    private String productActivatedRoutingKey;

    private final RabbitTemplate rabbitTemplate;

    public CatalogRabbitMessageBroker(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    @Override
    public void publishProductActivatedIntegrationEvent(ProductActivatedIntegrationEvent event) {
        EventEnvelope<ProductActivatedIntegrationEvent> envelope = EventEnvelope.of(
            productActivatedRoutingKey,
            event,
            MDC.get("correlationId")
        );

        rabbitTemplate.convertAndSend(exchange, productActivatedRoutingKey, envelope);
    }
}
