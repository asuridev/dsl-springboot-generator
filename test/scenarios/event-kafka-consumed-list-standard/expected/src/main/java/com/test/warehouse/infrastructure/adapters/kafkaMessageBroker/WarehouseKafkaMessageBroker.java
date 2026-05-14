package com.test.warehouse.infrastructure.adapters.kafkaMessageBroker;

import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import com.test.warehouse.application.events.ShipmentDispatchedIntegrationEvent;
import com.test.warehouse.application.ports.MessageBroker;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

/**
 * WarehouseKafkaMessageBroker — Kafka adapter implementing {@link MessageBroker}.
 *
 * Topics are resolved at runtime from parameters/{env}/kafka.yaml via @Value bindings.
 * derived_from: domainEvents.published (all entries)
 */
@Component("warehouseKafkaMessageBroker")
public class WarehouseKafkaMessageBroker implements MessageBroker {

    @Value("${topics.shipment-dispatched}")
    private String shipmentDispatchedTopic;

    private final KafkaTemplate<String, Object> kafkaTemplate;

    public WarehouseKafkaMessageBroker(KafkaTemplate<String, Object> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    @Override
    public void publishShipmentDispatchedIntegrationEvent(ShipmentDispatchedIntegrationEvent event) {
        EventEnvelope<ShipmentDispatchedIntegrationEvent> envelope = EventEnvelope.of(
            shipmentDispatchedTopic,
            event,
            MDC.get("correlationId")
        );

        kafkaTemplate.send(shipmentDispatchedTopic, envelope);
    }
}
