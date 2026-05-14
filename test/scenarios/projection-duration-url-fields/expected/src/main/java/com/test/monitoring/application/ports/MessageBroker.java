package com.test.monitoring.application.ports;

import com.test.monitoring.application.events.ServiceCheckCompletedIntegrationEvent;
import com.test.monitoring.application.events.ServiceLatencyUpdatedIntegrationEvent;

/**
 * MessageBroker — output port (secondary port) for asynchronous messaging.
 *
 * Decouples the application layer from any specific broker technology.
 * Implementations live in infrastructure/adapters/{brokerName}MessageBroker/
 * (e.g. kafkaMessageBroker or rabbitmqMessageBroker).
 */
public interface MessageBroker {
    void publishServiceCheckCompletedIntegrationEvent(ServiceCheckCompletedIntegrationEvent event);

    void publishServiceLatencyUpdatedIntegrationEvent(ServiceLatencyUpdatedIntegrationEvent event);
}
