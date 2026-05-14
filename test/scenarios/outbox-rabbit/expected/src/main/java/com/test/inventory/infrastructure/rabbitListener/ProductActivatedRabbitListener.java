package com.test.inventory.infrastructure.rabbitListener;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import com.test.inventory.application.commands.RegisterProductInCatalogCommand;
import com.test.shared.domain.customExceptions.DomainException;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import java.io.IOException;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * RabbitMQ listener for queue ${queues.inventory-product-activated}.
 * Consumes events produced by: catalog.
 * Dispatches to use case: register-product-in-catalog.
 * derived_from: domainEvents.consumed.ProductActivated
 */
@Component("inventory.ProductActivatedRabbitListener")
public class ProductActivatedRabbitListener {

    private static final Logger log = LoggerFactory.getLogger(ProductActivatedRabbitListener.class);

    private final UseCaseMediator useCaseMediator;
    private final ObjectMapper objectMapper;

    public ProductActivatedRabbitListener(UseCaseMediator useCaseMediator, ObjectMapper objectMapper) {
        this.useCaseMediator = useCaseMediator;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = "${queues.inventory-product-activated}")
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

        try {
            useCaseMediator.dispatch(new RegisterProductInCatalogCommand());
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
