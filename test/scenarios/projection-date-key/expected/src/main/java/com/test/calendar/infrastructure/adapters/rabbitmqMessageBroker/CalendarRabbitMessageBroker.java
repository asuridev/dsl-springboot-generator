package com.test.calendar.infrastructure.adapters.rabbitmqMessageBroker;

import com.test.calendar.application.events.SlotCapacityPublishedIntegrationEvent;
import com.test.calendar.application.ports.MessageBroker;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import org.slf4j.MDC;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * CalendarRabbitMessageBroker — RabbitMQ adapter implementing {@link MessageBroker}.
 *
 * Exchange and routing keys are resolved at runtime from parameters/{env}/rabbitmq.yaml
 * via @Value bindings, so no hardcoded strings are present here.
 * derived_from: domainEvents.published (all entries)
 */
@Component("calendarRabbitMessageBroker")
public class CalendarRabbitMessageBroker implements MessageBroker {

    @Value("${exchanges.calendar}")
    private String exchange;

    @Value("${routing-keys.slot-capacity-published}")
    private String slotCapacityPublishedRoutingKey;

    private final RabbitTemplate rabbitTemplate;

    public CalendarRabbitMessageBroker(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    @Override
    public void publishSlotCapacityPublishedIntegrationEvent(SlotCapacityPublishedIntegrationEvent event) {
        EventEnvelope<SlotCapacityPublishedIntegrationEvent> envelope = EventEnvelope.of(
            slotCapacityPublishedRoutingKey,
            event,
            MDC.get("correlationId")
        );

        rabbitTemplate.convertAndSend(exchange, slotCapacityPublishedRoutingKey, envelope);
    }
}
