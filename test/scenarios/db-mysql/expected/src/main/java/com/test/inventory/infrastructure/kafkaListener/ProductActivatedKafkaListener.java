package com.test.inventory.infrastructure.kafkaListener;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.test.inventory.application.commands.RegisterProductInCatalogCommand;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import com.test.shared.infrastructure.idempotency.IdempotencyGuard;
import java.util.Map;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

/**
 * Kafka listener for topic ${topics.inventory-product-activated}.
 * Consumes events produced by: catalog.
 * Dispatches to use case: register-product-in-catalog.
 * derived_from: domainEvents.consumed.ProductActivated
 */
@Component("inventory.ProductActivatedKafkaListener")
public class ProductActivatedKafkaListener {

    private static final Logger log = LoggerFactory.getLogger(ProductActivatedKafkaListener.class);

    private final UseCaseMediator useCaseMediator;
    private final ObjectMapper objectMapper;
    private final IdempotencyGuard idempotencyGuard;
    private static final String HANDLER_ID = "com.test.inventory.ProductActivatedKafkaListener";

    public ProductActivatedKafkaListener(
        UseCaseMediator useCaseMediator,
        ObjectMapper objectMapper,
        IdempotencyGuard idempotencyGuard
    ) {
        this.useCaseMediator = useCaseMediator;
        this.objectMapper = objectMapper;
        this.idempotencyGuard = idempotencyGuard;
    }

    @KafkaListener(topics = "${topics.inventory-product-activated}", groupId = "${spring.kafka.consumer.group-id}")
    public void handle(ConsumerRecord<String, String> record, Acknowledgment acknowledgment) {
        EventEnvelope<Map<String, Object>> event;
        try {
            event = objectMapper.readValue(record.value(), new TypeReference<EventEnvelope<Map<String, Object>>>() {});
        } catch (JsonProcessingException e) {
            log.error("Fatal deserialization error — skipping message: {}", e.getMessage());
            acknowledgment.acknowledge();
            return;
        }

        // derived_from: system.yaml#/infrastructure/reliability/consumerIdempotency
        String eventId = event.metadata() != null ? event.metadata().eventId() : null;
        if (eventId != null && !idempotencyGuard.tryRecord(HANDLER_ID, eventId)) {
            log.debug("Duplicate eventId={} for handler={} — acknowledging without dispatch", eventId, HANDLER_ID);
            acknowledgment.acknowledge();
            return;
        }

        try {
            useCaseMediator.dispatch(new RegisterProductInCatalogCommand());
            acknowledgment.acknowledge();
        } catch (Exception e) {
            log.error("Error dispatching RegisterProductInCatalogCommand: {}", e.getMessage(), e);
            // Do not acknowledge — allow retry according to consumer configuration
        }
    }
}
