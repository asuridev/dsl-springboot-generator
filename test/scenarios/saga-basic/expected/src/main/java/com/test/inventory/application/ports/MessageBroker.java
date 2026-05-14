package com.test.inventory.application.ports;

import com.test.inventory.application.events.StockReservationFailedIntegrationEvent;
import com.test.inventory.application.events.StockReservedIntegrationEvent;

/**
 * MessageBroker — output port (secondary port) for asynchronous messaging.
 *
 * Decouples the application layer from any specific broker technology.
 * Implementations live in infrastructure/adapters/{brokerName}MessageBroker/
 * (e.g. kafkaMessageBroker or rabbitmqMessageBroker).
 */
public interface MessageBroker {
    void publishStockReservedIntegrationEvent(StockReservedIntegrationEvent event);

    void publishStockReservationFailedIntegrationEvent(StockReservationFailedIntegrationEvent event);
}
