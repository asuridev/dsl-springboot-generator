package com.test.notifications.infrastructure.adapters.rabbitmqMessageBroker;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * RabbitMQ topology configuration for the notifications bounded context.
 *
 * Declares all exchanges, queues, dead-letter exchanges (DLX), dead-letter queues (DLQ)
 * and bindings needed by this BC. Values are resolved at runtime from
 * parameters/{env}/rabbitmq.yaml via @Value — no hardcoded strings.
 *
 * derived_from: domainEvents (published + consumed)
 */
@Configuration
public class NotificationsRabbitMQConfig {

    // ─── Consumer: events from warehouse ──────────────────────────────────────
    // Bean names are prefixed with the owning BC (notifications) to avoid collisions
    // when multiple BCs consume from the same producer exchange.

    @Value("${exchanges.warehouse}")
    private String notifications_warehouseExchangeName;

    @Bean("notifications_warehouseExchange")
    public TopicExchange notifications_warehouseExchange() {
        return new TopicExchange(notifications_warehouseExchangeName, true, false);
    }

    @Bean("notifications_warehouseDlxExchange")
    public TopicExchange notifications_warehouseDlxExchange() {
        return new TopicExchange(notifications_warehouseExchangeName + ".dlx", true, false);
    }

    // ─── ShipmentDispatched (from warehouse) ──────────────────────────────────

    @Value("${queues.notifications-shipment-dispatched}")
    private String notificationsShipmentDispatchedQueueName;

    @Value("${routing-keys.notifications-shipment-dispatched}")
    private String notificationsShipmentDispatchedRoutingKey;

    @Bean
    public Queue notificationsShipmentDispatchedQueue() {
        return QueueBuilder.durable(notificationsShipmentDispatchedQueueName)
            .withArgument("x-dead-letter-exchange", notifications_warehouseExchangeName + ".dlx")
            .build();
    }

    @Bean
    public Binding notificationsShipmentDispatchedBinding() {
        return BindingBuilder.bind(notificationsShipmentDispatchedQueue())
            .to(notifications_warehouseExchange())
            .with(notificationsShipmentDispatchedRoutingKey);
    }

    @Bean
    public Queue notificationsShipmentDispatchedDlq() {
        return QueueBuilder.durable(notificationsShipmentDispatchedQueueName + ".dlq").build();
    }

    @Bean
    public Binding notificationsShipmentDispatchedDlqBinding() {
        return BindingBuilder.bind(notificationsShipmentDispatchedDlq())
            .to(notifications_warehouseDlxExchange())
            .with(notificationsShipmentDispatchedRoutingKey);
    }
}
