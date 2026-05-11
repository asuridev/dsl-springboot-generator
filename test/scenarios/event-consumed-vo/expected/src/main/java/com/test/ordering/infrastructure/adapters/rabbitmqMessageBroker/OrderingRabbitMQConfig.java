package com.test.ordering.infrastructure.adapters.rabbitmqMessageBroker;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * RabbitMQ topology configuration for the ordering bounded context.
 *
 * Declares all exchanges, queues, dead-letter exchanges (DLX), dead-letter queues (DLQ)
 * and bindings needed by this BC. Values are resolved at runtime from
 * parameters/{env}/rabbitmq.yaml via @Value — no hardcoded strings.
 *
 * derived_from: domainEvents (published + consumed)
 */
@Configuration
public class OrderingRabbitMQConfig {

    // ─── Consumer: events from sales ──────────────────────────────────────
    // Bean names are prefixed with the owning BC (ordering) to avoid collisions
    // when multiple BCs consume from the same producer exchange.

    @Value("${exchanges.sales}")
    private String ordering_salesExchangeName;

    @Bean("ordering_salesExchange")
    public TopicExchange ordering_salesExchange() {
        return new TopicExchange(ordering_salesExchangeName, true, false);
    }

    @Bean("ordering_salesDlxExchange")
    public TopicExchange ordering_salesDlxExchange() {
        return new TopicExchange(ordering_salesExchangeName + ".dlx", true, false);
    }

    // ─── OrderPlaced (from sales) ──────────────────────────────────

    @Value("${queues.ordering-order-placed}")
    private String orderingOrderPlacedQueueName;

    @Value("${routing-keys.ordering-order-placed}")
    private String orderingOrderPlacedRoutingKey;

    @Bean
    public Queue orderingOrderPlacedQueue() {
        return QueueBuilder.durable(orderingOrderPlacedQueueName)
            .withArgument("x-dead-letter-exchange", ordering_salesExchangeName + ".dlx")
            .build();
    }

    @Bean
    public Binding orderingOrderPlacedBinding() {
        return BindingBuilder.bind(orderingOrderPlacedQueue())
            .to(ordering_salesExchange())
            .with(orderingOrderPlacedRoutingKey);
    }

    @Bean
    public Queue orderingOrderPlacedDlq() {
        return QueueBuilder.durable(orderingOrderPlacedQueueName + ".dlq").build();
    }

    @Bean
    public Binding orderingOrderPlacedDlqBinding() {
        return BindingBuilder.bind(orderingOrderPlacedDlq())
            .to(ordering_salesDlxExchange())
            .with(orderingOrderPlacedRoutingKey);
    }
}
