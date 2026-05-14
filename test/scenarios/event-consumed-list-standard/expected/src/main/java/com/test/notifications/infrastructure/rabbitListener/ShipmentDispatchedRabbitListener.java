package com.test.notifications.infrastructure.rabbitListener;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import com.test.notifications.application.commands.NotifyShipmentDispatchedCommand;
import com.test.shared.domain.customExceptions.DomainException;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * RabbitMQ listener for queue ${queues.notifications-shipment-dispatched}.
 * Consumes events produced by: warehouse.
 * Dispatches to use case: notify-shipment-dispatched.
 * derived_from: domainEvents.consumed.ShipmentDispatched
 */
@Component("notifications.ShipmentDispatchedRabbitListener")
public class ShipmentDispatchedRabbitListener {

    private static final Logger log = LoggerFactory.getLogger(ShipmentDispatchedRabbitListener.class);

    private final UseCaseMediator useCaseMediator;
    private final ObjectMapper objectMapper;

    public ShipmentDispatchedRabbitListener(UseCaseMediator useCaseMediator, ObjectMapper objectMapper) {
        this.useCaseMediator = useCaseMediator;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = "${queues.notifications-shipment-dispatched}")
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
        }
    }
}
