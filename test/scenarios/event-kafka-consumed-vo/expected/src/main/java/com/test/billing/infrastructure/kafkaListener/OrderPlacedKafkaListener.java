package com.test.billing.infrastructure.kafkaListener;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.test.billing.application.commands.CreateInvoiceFromOrderCommand;
import com.test.billing.domain.enums.OrderStatus;
import com.test.billing.domain.valueobject.Money;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import java.util.Map;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

/**
 * Kafka listener for topic ${topics.billing-order-placed}.
 * Consumes events produced by: sales.
 * Dispatches to use case: create-invoice-from-order.
 * derived_from: domainEvents.consumed.OrderPlaced
 */
@Component("billing.OrderPlacedKafkaListener")
public class OrderPlacedKafkaListener {

    private static final Logger log = LoggerFactory.getLogger(OrderPlacedKafkaListener.class);

    private final UseCaseMediator useCaseMediator;
    private final ObjectMapper objectMapper;

    public OrderPlacedKafkaListener(UseCaseMediator useCaseMediator, ObjectMapper objectMapper) {
        this.useCaseMediator = useCaseMediator;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(topics = "${topics.billing-order-placed}", groupId = "${spring.kafka.consumer.group-id}")
    public void handle(ConsumerRecord<String, String> record, Acknowledgment acknowledgment) {
        EventEnvelope<Map<String, Object>> event;
        try {
            event = objectMapper.readValue(record.value(), new TypeReference<EventEnvelope<Map<String, Object>>>() {});
        } catch (JsonProcessingException e) {
            log.error("Fatal deserialization error — skipping message: {}", e.getMessage());
            acknowledgment.acknowledge();
            return;
        }

        UUID orderId = objectMapper.convertValue(event.data().get("orderId"), UUID.class);

        Money totalAmount = objectMapper.convertValue(event.data().get("totalAmount"), Money.class);

        OrderStatus status = objectMapper.convertValue(event.data().get("status"), OrderStatus.class);

        try {
            useCaseMediator.dispatch(new CreateInvoiceFromOrderCommand(orderId, totalAmount, status));
            acknowledgment.acknowledge();
        } catch (Exception e) {
            log.error("Error dispatching CreateInvoiceFromOrderCommand: {}", e.getMessage(), e);
            // Do not acknowledge — allow retry according to consumer configuration
        }
    }
}
