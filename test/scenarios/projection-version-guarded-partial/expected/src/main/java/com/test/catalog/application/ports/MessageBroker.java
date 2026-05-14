package com.test.catalog.application.ports;

import com.test.catalog.application.events.StockInitializedIntegrationEvent;
import com.test.catalog.application.events.StockReservedIntegrationEvent;

/**
 * MessageBroker — output port (secondary port) for asynchronous messaging.
 *
 * Decouples the application layer from any specific broker technology.
 * Implementations live in infrastructure/adapters/{brokerName}MessageBroker/
 * (e.g. kafkaMessageBroker or rabbitmqMessageBroker).
 */
public interface MessageBroker {
    void publishStockInitializedIntegrationEvent(StockInitializedIntegrationEvent event);

    void publishStockReservedIntegrationEvent(StockReservedIntegrationEvent event);
}
