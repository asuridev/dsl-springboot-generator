package com.test.catalog.application.ports;

import com.test.catalog.application.events.ProductActivatedIntegrationEvent;
import com.test.catalog.application.events.ProductPriceChangedIntegrationEvent;

/**
 * MessageBroker — output port (secondary port) for asynchronous messaging.
 *
 * Decouples the application layer from any specific broker technology.
 * Implementations live in infrastructure/adapters/{brokerName}MessageBroker/
 * (e.g. kafkaMessageBroker or rabbitmqMessageBroker).
 */
public interface MessageBroker {
    void publishProductActivatedIntegrationEvent(ProductActivatedIntegrationEvent event);

    void publishProductPriceChangedIntegrationEvent(ProductPriceChangedIntegrationEvent event);
}
