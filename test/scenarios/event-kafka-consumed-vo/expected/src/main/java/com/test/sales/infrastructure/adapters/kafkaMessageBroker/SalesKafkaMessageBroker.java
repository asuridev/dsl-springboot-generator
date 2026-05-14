package com.test.sales.infrastructure.adapters.kafkaMessageBroker;

import com.test.sales.application.events.OrderPlacedIntegrationEvent;
import com.test.sales.application.ports.MessageBroker;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

/**
 * SalesKafkaMessageBroker — Kafka adapter implementing {@link MessageBroker}.
 *
 * Topics are resolved at runtime from parameters/{env}/kafka.yaml via @Value bindings.
 * derived_from: domainEvents.published (all entries)
 */
@Component("salesKafkaMessageBroker")
public class SalesKafkaMessageBroker implements MessageBroker {

    @Value("${topics.order-placed}")
    private String orderPlacedTopic;

    private final KafkaTemplate<String, Object> kafkaTemplate;

    public SalesKafkaMessageBroker(KafkaTemplate<String, Object> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    @Override
    public void publishOrderPlacedIntegrationEvent(OrderPlacedIntegrationEvent event) {
        EventEnvelope<OrderPlacedIntegrationEvent> envelope = EventEnvelope.of(
            orderPlacedTopic,
            event,
            MDC.get("correlationId")
        );

        kafkaTemplate.send(orderPlacedTopic, envelope);
    }
}
