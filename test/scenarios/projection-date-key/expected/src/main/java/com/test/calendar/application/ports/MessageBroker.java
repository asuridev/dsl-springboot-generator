package com.test.calendar.application.ports;

import com.test.calendar.application.events.SlotCapacityPublishedIntegrationEvent;

/**
 * MessageBroker — output port (secondary port) for asynchronous messaging.
 *
 * Decouples the application layer from any specific broker technology.
 * Implementations live in infrastructure/adapters/{brokerName}MessageBroker/
 * (e.g. kafkaMessageBroker or rabbitmqMessageBroker).
 */
public interface MessageBroker {
    void publishSlotCapacityPublishedIntegrationEvent(SlotCapacityPublishedIntegrationEvent event);
}
