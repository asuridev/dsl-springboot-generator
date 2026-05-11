package com.test.sales.infrastructure.adapters.rabbitmqMessageBroker;

import org.springframework.amqp.core.TopicExchange;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * RabbitMQ topology configuration for the sales bounded context.
 *
 * Declares all exchanges, queues, dead-letter exchanges (DLX), dead-letter queues (DLQ)
 * and bindings needed by this BC. Values are resolved at runtime from
 * parameters/{env}/rabbitmq.yaml via @Value — no hardcoded strings.
 *
 * derived_from: domainEvents (published + consumed)
 */
@Configuration
public class SalesRabbitMQConfig {

    // ─── Publisher exchange for sales ──────────────────────────────────────

    @Value("${exchanges.sales}")
    private String salesExchangeName;

    @Bean
    public TopicExchange salesExchange() {
        return new TopicExchange(salesExchangeName, true, false);
    }

    @Bean
    public TopicExchange salesDlxExchange() {
        return new TopicExchange(salesExchangeName + ".dlx", true, false);
    }
    // Consumers declare their own queues bound to this exchange — the publisher BC
    // does not declare queues for its own events. See consumersByProducer section below.
}
