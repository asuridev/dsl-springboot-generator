package com.test.warehouse.infrastructure.adapters.rabbitmqMessageBroker;

import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import com.test.warehouse.application.events.ShipmentDispatchedIntegrationEvent;
import com.test.warehouse.application.ports.MessageBroker;
import org.slf4j.MDC;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * WarehouseRabbitMessageBroker — RabbitMQ adapter implementing {@link MessageBroker}.
 *
 * Exchange and routing keys are resolved at runtime from parameters/{env}/rabbitmq.yaml
 * via @Value bindings, so no hardcoded strings are present here.
 * derived_from: domainEvents.published (all entries)
 */
@Component("warehouseRabbitMessageBroker")
public class WarehouseRabbitMessageBroker implements MessageBroker {

    @Value("${exchanges.warehouse}")
    private String exchange;

    @Value("${routing-keys.shipment-dispatched}")
    private String shipmentDispatchedRoutingKey;

    private final RabbitTemplate rabbitTemplate;

    public WarehouseRabbitMessageBroker(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    @Override
    public void publishShipmentDispatchedIntegrationEvent(ShipmentDispatchedIntegrationEvent event) {
        EventEnvelope<ShipmentDispatchedIntegrationEvent> envelope = EventEnvelope.of(
            shipmentDispatchedRoutingKey,
            event,
            MDC.get("correlationId")
        );

        rabbitTemplate.convertAndSend(exchange, shipmentDispatchedRoutingKey, envelope);
    }
}
