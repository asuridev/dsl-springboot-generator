package com.test.catalog.infrastructure.adapters.rabbitmqMessageBroker;

import org.springframework.amqp.core.TopicExchange;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * RabbitMQ topology configuration for the catalog bounded context.
 *
 * Declares all exchanges, queues, dead-letter exchanges (DLX), dead-letter queues (DLQ)
 * and bindings needed by this BC. Values are resolved at runtime from
 * parameters/{env}/rabbitmq.yaml via @Value — no hardcoded strings.
 *
 * derived_from: domainEvents (published + consumed)
 */
@Configuration
public class CatalogRabbitMQConfig {

    // ─── Publisher exchange for catalog ──────────────────────────────────────

    @Value("${exchanges.catalog}")
    private String catalogExchangeName;

    @Bean
    public TopicExchange catalogExchange() {
        return new TopicExchange(catalogExchangeName, true, false);
    }

    @Bean
    public TopicExchange catalogDlxExchange() {
        return new TopicExchange(catalogExchangeName + ".dlx", true, false);
    }
    // Consumers declare their own queues bound to this exchange — the publisher BC
    // does not declare queues for its own events. See consumersByProducer section below.
}
