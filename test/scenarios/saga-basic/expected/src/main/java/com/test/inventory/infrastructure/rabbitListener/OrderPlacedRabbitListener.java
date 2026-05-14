package com.test.inventory.infrastructure.rabbitListener;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import com.test.inventory.application.commands.ReserveStockCommand;
import com.test.shared.domain.annotations.SagaStep;
import com.test.shared.domain.customExceptions.DomainException;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import com.test.shared.infrastructure.correlation.CorrelationContext;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * RabbitMQ listener for queue ${queues.inventory-order-placed}.
 * Consumes events produced by: orders.
 * Dispatches to use case: ReserveStock.
 * derived_from: domainEvents.consumed.OrderPlaced
 */
@Component("inventory.OrderPlacedRabbitListener")
public class OrderPlacedRabbitListener {

    private static final Logger log = LoggerFactory.getLogger(OrderPlacedRabbitListener.class);

    private final UseCaseMediator useCaseMediator;
    private final ObjectMapper objectMapper;

    public OrderPlacedRabbitListener(UseCaseMediator useCaseMediator, ObjectMapper objectMapper) {
        this.useCaseMediator = useCaseMediator;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = "${queues.inventory-order-placed}")
    @SagaStep(saga = "CheckoutSaga", order = 0, event = "OrderPlaced", role = SagaStep.Role.TRIGGER)
    public void handle(Message message, Channel channel) throws IOException {
        long deliveryTag = message.getMessageProperties().getDeliveryTag();

        EventEnvelope<Map<String, Object>> event;
        try {
            event = objectMapper.readValue(
                message.getBody(),
                new TypeReference<EventEnvelope<Map<String, Object>>>() {}
            );
        } catch (JsonProcessingException e) {
            log.error("Fatal deserialization error — sending to DLQ: {}", e.getMessage());
            channel.basicNack(deliveryTag, false, false);
            return;
        }

        // derived_from: system.yaml#/sagas — propagate correlationId across hops
        String correlationId = event.metadata() != null ? event.metadata().correlationId() : null;
        CorrelationContext.set(correlationId);

        UUID orderId = objectMapper.convertValue(event.data().get("orderId"), UUID.class);

        UUID customerId = objectMapper.convertValue(event.data().get("customerId"), UUID.class);

        try {
            useCaseMediator.dispatch(new ReserveStockCommand(orderId, customerId));
            channel.basicAck(deliveryTag, false);
        } catch (DomainException e) {
            log.error(
                "Domain error — sending to DLQ immediately. queue={}, error={}",
                message.getMessageProperties().getConsumerQueue(),
                e.getMessage(),
                e
            );
            channel.basicNack(deliveryTag, false, false);
        } catch (RuntimeException e) {
            log.warn(
                "Infrastructure error — will retry. queue={}, error={}",
                message.getMessageProperties().getConsumerQueue(),
                e.getMessage(),
                e
            );
            throw e;
        } finally {
            CorrelationContext.clear();
        }
    }
}
