package com.test.orders.application.ports;

import com.test.orders.application.events.OrderPlacedIntegrationEvent;

/**
 * MessageBroker — output port (secondary port) for asynchronous messaging.
 *
 * Decouples the application layer from any specific broker technology.
 * Implementations live in infrastructure/adapters/{brokerName}MessageBroker/
 * (e.g. kafkaMessageBroker or rabbitmqMessageBroker).
 */
public interface MessageBroker {
    void publishOrderPlacedIntegrationEvent(OrderPlacedIntegrationEvent event);
}
