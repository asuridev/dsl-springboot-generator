package com.test.monitoring.infrastructure.adapters.kafkaMessageBroker;

import com.test.monitoring.application.events.ServiceCheckCompletedIntegrationEvent;
import com.test.monitoring.application.events.ServiceLatencyUpdatedIntegrationEvent;
import com.test.monitoring.application.ports.MessageBroker;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

/**
 * MonitoringKafkaMessageBroker — Kafka adapter implementing {@link MessageBroker}.
 *
 * Topics are resolved at runtime from parameters/{env}/kafka.yaml via @Value bindings.
 * derived_from: domainEvents.published (all entries)
 */
@Component("monitoringKafkaMessageBroker")
public class MonitoringKafkaMessageBroker implements MessageBroker {

    @Value("${topics.service-check-completed}")
    private String serviceCheckCompletedTopic;

    @Value("${topics.service-latency-updated}")
    private String serviceLatencyUpdatedTopic;

    private final KafkaTemplate<String, Object> kafkaTemplate;

    public MonitoringKafkaMessageBroker(KafkaTemplate<String, Object> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    @Override
    public void publishServiceCheckCompletedIntegrationEvent(ServiceCheckCompletedIntegrationEvent event) {
        EventEnvelope<ServiceCheckCompletedIntegrationEvent> envelope = EventEnvelope.of(
            serviceCheckCompletedTopic,
            event,
            MDC.get("correlationId")
        );

        kafkaTemplate.send(serviceCheckCompletedTopic, envelope);
    }

    @Override
    public void publishServiceLatencyUpdatedIntegrationEvent(ServiceLatencyUpdatedIntegrationEvent event) {
        EventEnvelope<ServiceLatencyUpdatedIntegrationEvent> envelope = EventEnvelope.of(
            serviceLatencyUpdatedTopic,
            event,
            MDC.get("correlationId")
        );

        kafkaTemplate.send(serviceLatencyUpdatedTopic, envelope);
    }
}
