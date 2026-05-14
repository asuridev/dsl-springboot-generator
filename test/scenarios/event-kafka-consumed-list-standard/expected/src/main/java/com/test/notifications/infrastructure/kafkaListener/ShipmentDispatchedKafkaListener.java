package com.test.notifications.infrastructure.kafkaListener;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.test.notifications.application.commands.NotifyShipmentDispatchedCommand;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

/**
 * Kafka listener for topic ${topics.notifications-shipment-dispatched}.
 * Consumes events produced by: warehouse.
 * Dispatches to use case: notify-shipment-dispatched.
 * derived_from: domainEvents.consumed.ShipmentDispatched
 */
@Component("notifications.ShipmentDispatchedKafkaListener")
public class ShipmentDispatchedKafkaListener {

    private static final Logger log = LoggerFactory.getLogger(ShipmentDispatchedKafkaListener.class);

    private final UseCaseMediator useCaseMediator;
    private final ObjectMapper objectMapper;

    public ShipmentDispatchedKafkaListener(UseCaseMediator useCaseMediator, ObjectMapper objectMapper) {
        this.useCaseMediator = useCaseMediator;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(
        topics = "${topics.notifications-shipment-dispatched}",
        groupId = "${spring.kafka.consumer.group-id}"
    )
    public void handle(ConsumerRecord<String, String> record, Acknowledgment acknowledgment) {
        EventEnvelope<Map<String, Object>> event;
        try {
            event = objectMapper.readValue(record.value(), new TypeReference<EventEnvelope<Map<String, Object>>>() {});
        } catch (JsonProcessingException e) {
            log.error("Fatal deserialization error — skipping message: {}", e.getMessage());
            acknowledgment.acknowledge();
            return;
        }

        UUID shipmentId = objectMapper.convertValue(event.data().get("shipmentId"), UUID.class);

        List<UUID> productIds = objectMapper.convertValue(
            event.data().get("productIds"),
            objectMapper.getTypeFactory().constructCollectionType(List.class, UUID.class)
        );

        List<Instant> checkpointTimes = objectMapper.convertValue(
            event.data().get("checkpointTimes"),
            objectMapper.getTypeFactory().constructCollectionType(List.class, Instant.class)
        );

        try {
            useCaseMediator.dispatch(new NotifyShipmentDispatchedCommand(shipmentId, productIds, checkpointTimes));
            acknowledgment.acknowledge();
        } catch (Exception e) {
            log.error("Error dispatching NotifyShipmentDispatchedCommand: {}", e.getMessage(), e);
            // Do not acknowledge — allow retry according to consumer configuration
        }
    }
}
