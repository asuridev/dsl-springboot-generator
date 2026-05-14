// derived_from: system.yaml#/infrastructure/reliability/outbox
package com.test.shared.infrastructure.outbox;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Polls the {@code outbox_event} table and forwards pending rows to RabbitMQ.
 *
 * Each row is published as a JSON message ({@code application/json}) using the
 * stored exchange/routing-key. On success the row is marked as published; on
 * failure the attempt counter is incremented and the loop continues.
 *
 * derived_from: system.yaml#/infrastructure/reliability/outbox
 */
@Component
public class OutboxRelay {

    private static final Logger log = LoggerFactory.getLogger(OutboxRelay.class);
    private static final int BATCH_SIZE = 100;

    private final OutboxEventJpaRepository outboxRepository;
    private final RabbitTemplate rabbitTemplate;

    public OutboxRelay(OutboxEventJpaRepository outboxRepository, RabbitTemplate rabbitTemplate) {
        this.outboxRepository = outboxRepository;
        this.rabbitTemplate = rabbitTemplate;
    }

    @Scheduled(fixedDelayString = "${outbox.relay.fixed-delay-ms:1000}")
    @Transactional
    public void relay() {
        List<OutboxEventJpa> pending = outboxRepository.findPending(PageRequest.of(0, BATCH_SIZE));
        if (pending.isEmpty()) return;

        for (OutboxEventJpa row : pending) {
            try {
                MessageProperties props = new MessageProperties();
                props.setContentType(MessageProperties.CONTENT_TYPE_JSON);
                props.setMessageId(row.getId().toString());
                Message message = MessageBuilder.withBody(row.getPayload().getBytes(StandardCharsets.UTF_8))
                    .andProperties(props)
                    .build();

                rabbitTemplate.send(row.getDestination(), row.getRoutingKey(), message);

                row.setPublishedAt(Instant.now());
                outboxRepository.save(row);
            } catch (RuntimeException ex) {
                row.setAttempts(row.getAttempts() + 1);
                row.setLastError(truncate(ex.getMessage(), 1024));
                outboxRepository.save(row);
                log.warn(
                    "Outbox relay failed for id={} (attempt {}): {}",
                    row.getId(),
                    row.getAttempts(),
                    ex.getMessage()
                );
            }
        }
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
