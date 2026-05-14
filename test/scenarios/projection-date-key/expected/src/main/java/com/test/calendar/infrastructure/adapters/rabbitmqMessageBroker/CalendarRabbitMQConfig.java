package com.test.calendar.infrastructure.adapters.rabbitmqMessageBroker;

import org.springframework.amqp.core.TopicExchange;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * RabbitMQ topology configuration for the calendar bounded context.
 *
 * Declares all exchanges, queues, dead-letter exchanges (DLX), dead-letter queues (DLQ)
 * and bindings needed by this BC. Values are resolved at runtime from
 * parameters/{env}/rabbitmq.yaml via @Value — no hardcoded strings.
 *
 * derived_from: domainEvents (published + consumed)
 */
@Configuration
public class CalendarRabbitMQConfig {

    // ─── Publisher exchange for calendar ──────────────────────────────────────

    @Value("${exchanges.calendar}")
    private String calendarExchangeName;

    @Bean
    public TopicExchange calendarExchange() {
        return new TopicExchange(calendarExchangeName, true, false);
    }

    @Bean
    public TopicExchange calendarDlxExchange() {
        return new TopicExchange(calendarExchangeName + ".dlx", true, false);
    }
    // Consumers declare their own queues bound to this exchange — the publisher BC
    // does not declare queues for its own events. See consumersByProducer section below.
}
