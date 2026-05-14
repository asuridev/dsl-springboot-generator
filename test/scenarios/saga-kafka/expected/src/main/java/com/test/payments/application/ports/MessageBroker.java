package com.test.payments.application.ports;

import com.test.payments.application.events.PaymentApprovedIntegrationEvent;
import com.test.payments.application.events.PaymentFailedIntegrationEvent;

/**
 * MessageBroker — output port (secondary port) for asynchronous messaging.
 *
 * Decouples the application layer from any specific broker technology.
 * Implementations live in infrastructure/adapters/{brokerName}MessageBroker/
 * (e.g. kafkaMessageBroker or rabbitmqMessageBroker).
 */
public interface MessageBroker {
    void publishPaymentApprovedIntegrationEvent(PaymentApprovedIntegrationEvent event);

    void publishPaymentFailedIntegrationEvent(PaymentFailedIntegrationEvent event);
}
