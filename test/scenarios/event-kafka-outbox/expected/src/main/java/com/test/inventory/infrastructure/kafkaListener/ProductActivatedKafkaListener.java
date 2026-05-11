package com.test.inventory.infrastructure.kafkaListener;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.test.inventory.application.commands.RegisterProductInCatalogCommand;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
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

    public ProductActivatedKafkaListener(UseCaseMediator useCaseMediator, ObjectMapper objectMapper) {
        this.useCaseMediator = useCaseMediator;
        this.objectMapper = objectMapper;
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

        try {
            useCaseMediator.dispatch(new RegisterProductInCatalogCommand());
            acknowledgment.acknowledge();
        } catch (Exception e) {
            log.error("Error dispatching RegisterProductInCatalogCommand: {}", e.getMessage(), e);
            // Do not acknowledge — allow retry according to consumer configuration
        }
    }
}
