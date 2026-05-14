package com.test.catalog.infrastructure.adapters.kafkaMessageBroker;

import com.test.catalog.application.events.StockInitializedIntegrationEvent;
import com.test.catalog.application.events.StockReservedIntegrationEvent;
import com.test.catalog.application.ports.MessageBroker;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

/**
 * CatalogKafkaMessageBroker — Kafka adapter implementing {@link MessageBroker}.
 *
 * Topics are resolved at runtime from parameters/{env}/kafka.yaml via @Value bindings.
 * derived_from: domainEvents.published (all entries)
 */
@Component("catalogKafkaMessageBroker")
public class CatalogKafkaMessageBroker implements MessageBroker {

    @Value("${topics.stock-initialized}")
    private String stockInitializedTopic;

    @Value("${topics.stock-reserved}")
    private String stockReservedTopic;

    private final KafkaTemplate<String, Object> kafkaTemplate;

    public CatalogKafkaMessageBroker(KafkaTemplate<String, Object> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    @Override
    public void publishStockInitializedIntegrationEvent(StockInitializedIntegrationEvent event) {
        EventEnvelope<StockInitializedIntegrationEvent> envelope = EventEnvelope.of(
            stockInitializedTopic,
            event,
            MDC.get("correlationId")
        );

        kafkaTemplate.send(stockInitializedTopic, envelope);
    }

    @Override
    public void publishStockReservedIntegrationEvent(StockReservedIntegrationEvent event) {
        EventEnvelope<StockReservedIntegrationEvent> envelope = EventEnvelope.of(
            stockReservedTopic,
            event,
            MDC.get("correlationId")
        );

        kafkaTemplate.send(stockReservedTopic, envelope);
    }
}
