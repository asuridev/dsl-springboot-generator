package com.test.payments.infrastructure.kafkaListener;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.test.payments.application.commands.ProcessPaymentCommand;
import com.test.shared.domain.annotations.SagaStep;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import com.test.shared.infrastructure.correlation.CorrelationContext;
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
 * Kafka listener for topic ${topics.payments-order-placed}.
 * Consumes events produced by: orders.
 * Dispatches to use case: ProcessPayment.
 * derived_from: domainEvents.consumed.OrderPlaced
 */
@Component("payments.OrderPlacedKafkaListener")
public class OrderPlacedKafkaListener {

    private static final Logger log = LoggerFactory.getLogger(OrderPlacedKafkaListener.class);

    private final UseCaseMediator useCaseMediator;
    private final ObjectMapper objectMapper;

    public OrderPlacedKafkaListener(UseCaseMediator useCaseMediator, ObjectMapper objectMapper) {
        this.useCaseMediator = useCaseMediator;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(topics = "${topics.payments-order-placed}", groupId = "${spring.kafka.consumer.group-id}")
    @SagaStep(saga = "PaymentSaga", order = 0, event = "OrderPlaced", role = SagaStep.Role.TRIGGER)
    public void handle(ConsumerRecord<String, String> record, Acknowledgment acknowledgment) {
        EventEnvelope<Map<String, Object>> event;
        try {
            event = objectMapper.readValue(record.value(), new TypeReference<EventEnvelope<Map<String, Object>>>() {});
        } catch (JsonProcessingException e) {
            log.error("Fatal deserialization error — skipping message: {}", e.getMessage());
            acknowledgment.acknowledge();
            return;
        }

        // derived_from: system.yaml#/sagas — propagate correlationId across hops
        String correlationId = event.metadata() != null ? event.metadata().correlationId() : null;
        CorrelationContext.set(correlationId);

        UUID orderId = objectMapper.convertValue(event.data().get("orderId"), UUID.class);

        UUID customerId = objectMapper.convertValue(event.data().get("customerId"), UUID.class);

        try {
            useCaseMediator.dispatch(new ProcessPaymentCommand(orderId, customerId));
            acknowledgment.acknowledge();
        } catch (Exception e) {
            log.error("Error dispatching ProcessPaymentCommand: {}", e.getMessage(), e);
            // Do not acknowledge — allow retry according to consumer configuration
        } finally {
            CorrelationContext.clear();
        }
    }
}
