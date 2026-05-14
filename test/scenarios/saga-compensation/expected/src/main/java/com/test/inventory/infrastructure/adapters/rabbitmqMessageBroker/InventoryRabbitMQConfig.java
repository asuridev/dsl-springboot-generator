package com.test.inventory.infrastructure.adapters.rabbitmqMessageBroker;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * RabbitMQ topology configuration for the inventory bounded context.
 *
 * Declares all exchanges, queues, dead-letter exchanges (DLX), dead-letter queues (DLQ)
 * and bindings needed by this BC. Values are resolved at runtime from
 * parameters/{env}/rabbitmq.yaml via @Value — no hardcoded strings.
 *
 * derived_from: domainEvents (published + consumed)
 */
@Configuration
public class InventoryRabbitMQConfig {

    // ─── Publisher exchange for inventory ──────────────────────────────────────

    @Value("${exchanges.inventory}")
    private String inventoryExchangeName;

    @Bean
    public TopicExchange inventoryExchange() {
        return new TopicExchange(inventoryExchangeName, true, false);
    }

    @Bean
    public TopicExchange inventoryDlxExchange() {
        return new TopicExchange(inventoryExchangeName + ".dlx", true, false);
    }

    // Consumers declare their own queues bound to this exchange — the publisher BC
    // does not declare queues for its own events. See consumersByProducer section below.

    // ─── Consumer: events from orders ──────────────────────────────────────
    // Bean names are prefixed with the owning BC (inventory) to avoid collisions
    // when multiple BCs consume from the same producer exchange.

    @Value("${exchanges.orders}")
    private String inventory_ordersExchangeName;

    @Bean("inventory_ordersExchange")
    public TopicExchange inventory_ordersExchange() {
        return new TopicExchange(inventory_ordersExchangeName, true, false);
    }

    @Bean("inventory_ordersDlxExchange")
    public TopicExchange inventory_ordersDlxExchange() {
        return new TopicExchange(inventory_ordersExchangeName + ".dlx", true, false);
    }

    // ─── OrderPlaced (from orders) ──────────────────────────────────

    @Value("${queues.inventory-order-placed}")
    private String inventoryOrderPlacedQueueName;

    @Value("${routing-keys.inventory-order-placed}")
    private String inventoryOrderPlacedRoutingKey;

    @Bean
    public Queue inventoryOrderPlacedQueue() {
        return QueueBuilder.durable(inventoryOrderPlacedQueueName)
            .withArgument("x-dead-letter-exchange", inventory_ordersExchangeName + ".dlx")
            .build();
    }

    @Bean
    public Binding inventoryOrderPlacedBinding() {
        return BindingBuilder.bind(inventoryOrderPlacedQueue())
            .to(inventory_ordersExchange())
            .with(inventoryOrderPlacedRoutingKey);
    }

    @Bean
    public Queue inventoryOrderPlacedDlq() {
        return QueueBuilder.durable(inventoryOrderPlacedQueueName + ".dlq").build();
    }

    @Bean
    public Binding inventoryOrderPlacedDlqBinding() {
        return BindingBuilder.bind(inventoryOrderPlacedDlq())
            .to(inventory_ordersDlxExchange())
            .with(inventoryOrderPlacedRoutingKey);
    }

    // ─── Consumer: events from payments ──────────────────────────────────────
    // Bean names are prefixed with the owning BC (inventory) to avoid collisions
    // when multiple BCs consume from the same producer exchange.

    @Value("${exchanges.payments}")
    private String inventory_paymentsExchangeName;

    @Bean("inventory_paymentsExchange")
    public TopicExchange inventory_paymentsExchange() {
        return new TopicExchange(inventory_paymentsExchangeName, true, false);
    }

    @Bean("inventory_paymentsDlxExchange")
    public TopicExchange inventory_paymentsDlxExchange() {
        return new TopicExchange(inventory_paymentsExchangeName + ".dlx", true, false);
    }

    // ─── PaymentFailed (from payments) ──────────────────────────────────

    @Value("${queues.inventory-payment-failed}")
    private String inventoryPaymentFailedQueueName;

    @Value("${routing-keys.inventory-payment-failed}")
    private String inventoryPaymentFailedRoutingKey;

    @Bean
    public Queue inventoryPaymentFailedQueue() {
        return QueueBuilder.durable(inventoryPaymentFailedQueueName)
            .withArgument("x-dead-letter-exchange", inventory_paymentsExchangeName + ".dlx")
            .build();
    }

    @Bean
    public Binding inventoryPaymentFailedBinding() {
        return BindingBuilder.bind(inventoryPaymentFailedQueue())
            .to(inventory_paymentsExchange())
            .with(inventoryPaymentFailedRoutingKey);
    }

    @Bean
    public Queue inventoryPaymentFailedDlq() {
        return QueueBuilder.durable(inventoryPaymentFailedQueueName + ".dlq").build();
    }

    @Bean
    public Binding inventoryPaymentFailedDlqBinding() {
        return BindingBuilder.bind(inventoryPaymentFailedDlq())
            .to(inventory_paymentsDlxExchange())
            .with(inventoryPaymentFailedRoutingKey);
    }
}
