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

    // ─── Consumer: events from catalog ──────────────────────────────────────
    // Bean names are prefixed with the owning BC (inventory) to avoid collisions
    // when multiple BCs consume from the same producer exchange.

    @Value("${exchanges.catalog}")
    private String inventory_catalogExchangeName;

    @Bean("inventory_catalogExchange")
    public TopicExchange inventory_catalogExchange() {
        return new TopicExchange(inventory_catalogExchangeName, true, false);
    }

    @Bean("inventory_catalogDlxExchange")
    public TopicExchange inventory_catalogDlxExchange() {
        return new TopicExchange(inventory_catalogExchangeName + ".dlx", true, false);
    }

    // ─── ProductActivated (from catalog) ──────────────────────────────────

    @Value("${queues.inventory-product-activated}")
    private String inventoryProductActivatedQueueName;

    @Value("${routing-keys.inventory-product-activated}")
    private String inventoryProductActivatedRoutingKey;

    @Bean
    public Queue inventoryProductActivatedQueue() {
        return QueueBuilder.durable(inventoryProductActivatedQueueName)
            .withArgument("x-dead-letter-exchange", inventory_catalogExchangeName + ".dlx")
            .build();
    }

    @Bean
    public Binding inventoryProductActivatedBinding() {
        return BindingBuilder.bind(inventoryProductActivatedQueue())
            .to(inventory_catalogExchange())
            .with(inventoryProductActivatedRoutingKey);
    }

    @Bean
    public Queue inventoryProductActivatedDlq() {
        return QueueBuilder.durable(inventoryProductActivatedQueueName + ".dlq").build();
    }

    @Bean
    public Binding inventoryProductActivatedDlqBinding() {
        return BindingBuilder.bind(inventoryProductActivatedDlq())
            .to(inventory_catalogDlxExchange())
            .with(inventoryProductActivatedRoutingKey);
    }
}
