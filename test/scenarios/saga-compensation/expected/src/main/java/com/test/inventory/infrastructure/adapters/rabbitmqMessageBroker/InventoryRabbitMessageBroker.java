package com.test.inventory.infrastructure.adapters.rabbitmqMessageBroker;

import com.test.inventory.application.events.StockReleasedIntegrationEvent;
import com.test.inventory.application.events.StockReservationFailedIntegrationEvent;
import com.test.inventory.application.events.StockReservedIntegrationEvent;
import com.test.inventory.application.ports.MessageBroker;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import org.slf4j.MDC;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * InventoryRabbitMessageBroker — RabbitMQ adapter implementing {@link MessageBroker}.
 *
 * Exchange and routing keys are resolved at runtime from parameters/{env}/rabbitmq.yaml
 * via @Value bindings, so no hardcoded strings are present here.
 * derived_from: domainEvents.published (all entries)
 */
@Component("inventoryRabbitMessageBroker")
public class InventoryRabbitMessageBroker implements MessageBroker {

    @Value("${exchanges.inventory}")
    private String exchange;

    @Value("${routing-keys.stock-reserved}")
    private String stockReservedRoutingKey;

    @Value("${routing-keys.stock-reservation-failed}")
    private String stockReservationFailedRoutingKey;

    @Value("${routing-keys.stock-released}")
    private String stockReleasedRoutingKey;

    private final RabbitTemplate rabbitTemplate;

    public InventoryRabbitMessageBroker(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    @Override
    public void publishStockReservedIntegrationEvent(StockReservedIntegrationEvent event) {
        EventEnvelope<StockReservedIntegrationEvent> envelope = EventEnvelope.of(
            stockReservedRoutingKey,
            event,
            MDC.get("correlationId")
        );

        rabbitTemplate.convertAndSend(exchange, stockReservedRoutingKey, envelope);
    }

    @Override
    public void publishStockReservationFailedIntegrationEvent(StockReservationFailedIntegrationEvent event) {
        EventEnvelope<StockReservationFailedIntegrationEvent> envelope = EventEnvelope.of(
            stockReservationFailedRoutingKey,
            event,
            MDC.get("correlationId")
        );

        rabbitTemplate.convertAndSend(exchange, stockReservationFailedRoutingKey, envelope);
    }

    @Override
    public void publishStockReleasedIntegrationEvent(StockReleasedIntegrationEvent event) {
        EventEnvelope<StockReleasedIntegrationEvent> envelope = EventEnvelope.of(
            stockReleasedRoutingKey,
            event,
            MDC.get("correlationId")
        );

        rabbitTemplate.convertAndSend(exchange, stockReleasedRoutingKey, envelope);
    }
}
