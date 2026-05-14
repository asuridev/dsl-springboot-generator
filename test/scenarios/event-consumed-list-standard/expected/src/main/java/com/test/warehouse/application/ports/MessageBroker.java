package com.test.warehouse.application.ports;

import com.test.warehouse.application.events.ShipmentDispatchedIntegrationEvent;

/**
 * MessageBroker — output port (secondary port) for asynchronous messaging.
 *
 * Decouples the application layer from any specific broker technology.
 * Implementations live in infrastructure/adapters/{brokerName}MessageBroker/
 * (e.g. kafkaMessageBroker or rabbitmqMessageBroker).
 */
public interface MessageBroker {
    void publishShipmentDispatchedIntegrationEvent(ShipmentDispatchedIntegrationEvent event);
}
