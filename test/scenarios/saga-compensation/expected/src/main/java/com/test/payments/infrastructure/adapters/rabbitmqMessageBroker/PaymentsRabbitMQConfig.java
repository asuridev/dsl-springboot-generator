package com.test.payments.infrastructure.adapters.rabbitmqMessageBroker;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * RabbitMQ topology configuration for the payments bounded context.
 *
 * Declares all exchanges, queues, dead-letter exchanges (DLX), dead-letter queues (DLQ)
 * and bindings needed by this BC. Values are resolved at runtime from
 * parameters/{env}/rabbitmq.yaml via @Value — no hardcoded strings.
 *
 * derived_from: domainEvents (published + consumed)
 */
@Configuration
public class PaymentsRabbitMQConfig {

    // ─── Publisher exchange for payments ──────────────────────────────────────

    @Value("${exchanges.payments}")
    private String paymentsExchangeName;

    @Bean
    public TopicExchange paymentsExchange() {
        return new TopicExchange(paymentsExchangeName, true, false);
    }

    @Bean
    public TopicExchange paymentsDlxExchange() {
        return new TopicExchange(paymentsExchangeName + ".dlx", true, false);
    }

    // Consumers declare their own queues bound to this exchange — the publisher BC
    // does not declare queues for its own events. See consumersByProducer section below.

    // ─── Consumer: events from inventory ──────────────────────────────────────
    // Bean names are prefixed with the owning BC (payments) to avoid collisions
    // when multiple BCs consume from the same producer exchange.

    @Value("${exchanges.inventory}")
    private String payments_inventoryExchangeName;

    @Bean("payments_inventoryExchange")
    public TopicExchange payments_inventoryExchange() {
        return new TopicExchange(payments_inventoryExchangeName, true, false);
    }

    @Bean("payments_inventoryDlxExchange")
    public TopicExchange payments_inventoryDlxExchange() {
        return new TopicExchange(payments_inventoryExchangeName + ".dlx", true, false);
    }

    // ─── StockReserved (from inventory) ──────────────────────────────────

    @Value("${queues.payments-stock-reserved}")
    private String paymentsStockReservedQueueName;

    @Value("${routing-keys.payments-stock-reserved}")
    private String paymentsStockReservedRoutingKey;

    @Bean
    public Queue paymentsStockReservedQueue() {
        return QueueBuilder.durable(paymentsStockReservedQueueName)
            .withArgument("x-dead-letter-exchange", payments_inventoryExchangeName + ".dlx")
            .build();
    }

    @Bean
    public Binding paymentsStockReservedBinding() {
        return BindingBuilder.bind(paymentsStockReservedQueue())
            .to(payments_inventoryExchange())
            .with(paymentsStockReservedRoutingKey);
    }

    @Bean
    public Queue paymentsStockReservedDlq() {
        return QueueBuilder.durable(paymentsStockReservedQueueName + ".dlq").build();
    }

    @Bean
    public Binding paymentsStockReservedDlqBinding() {
        return BindingBuilder.bind(paymentsStockReservedDlq())
            .to(payments_inventoryDlxExchange())
            .with(paymentsStockReservedRoutingKey);
    }
}
