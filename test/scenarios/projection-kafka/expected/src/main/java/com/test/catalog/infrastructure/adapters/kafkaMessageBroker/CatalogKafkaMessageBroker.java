package com.test.catalog.infrastructure.adapters.kafkaMessageBroker;

import com.test.catalog.application.events.ProductActivatedIntegrationEvent;
import com.test.catalog.application.events.ProductPriceChangedIntegrationEvent;
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

    @Value("${topics.product-activated}")
    private String productActivatedTopic;

    @Value("${topics.product-price-changed}")
    private String productPriceChangedTopic;

    private final KafkaTemplate<String, Object> kafkaTemplate;

    public CatalogKafkaMessageBroker(KafkaTemplate<String, Object> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    @Override
    public void publishProductActivatedIntegrationEvent(ProductActivatedIntegrationEvent event) {
        EventEnvelope<ProductActivatedIntegrationEvent> envelope = EventEnvelope.of(
            productActivatedTopic,
            event,
            MDC.get("correlationId")
        );

        kafkaTemplate.send(productActivatedTopic, envelope);
    }

    @Override
    public void publishProductPriceChangedIntegrationEvent(ProductPriceChangedIntegrationEvent event) {
        EventEnvelope<ProductPriceChangedIntegrationEvent> envelope = EventEnvelope.of(
            productPriceChangedTopic,
            event,
            MDC.get("correlationId")
        );

        kafkaTemplate.send(productPriceChangedTopic, envelope);
    }
}
