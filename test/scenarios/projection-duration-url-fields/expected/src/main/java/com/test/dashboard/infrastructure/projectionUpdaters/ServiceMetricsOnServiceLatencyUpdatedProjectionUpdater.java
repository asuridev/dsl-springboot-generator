package com.test.dashboard.infrastructure.projectionUpdaters;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.test.dashboard.infrastructure.persistence.projections.ServiceMetricsJpa;
import com.test.dashboard.infrastructure.persistence.projections.ServiceMetricsJpaRepository;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Partial projection updater for ServiceMetrics — handles ServiceLatencyUpdated.
 * Only updates fields: averageLatency, score.
 * Never inserts new rows — if the key does not exist, the event is discarded.
 * derived_from: bc.dashboard.projections[ServiceMetrics].additionalSources[event=ServiceLatencyUpdated]
 * upsertStrategy: lastWriteWins (inherited from projection)
 */
@Component("dashboard.ServiceMetricsOnServiceLatencyUpdatedProjectionUpdater")
public class ServiceMetricsOnServiceLatencyUpdatedProjectionUpdater {

    private static final Logger log = LoggerFactory.getLogger(
        ServiceMetricsOnServiceLatencyUpdatedProjectionUpdater.class
    );

    private final ServiceMetricsJpaRepository repository;
    private final ObjectMapper objectMapper;

    public ServiceMetricsOnServiceLatencyUpdatedProjectionUpdater(
        ServiceMetricsJpaRepository repository,
        ObjectMapper objectMapper
    ) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(
        topics = "${topics.dashboard-projection-service-metrics-service-latency-updated}",
        groupId = "${spring.application.name}-ServiceMetricsOnServiceLatencyUpdated"
    )
    @Transactional
    public void handle(String payload, Acknowledgment acknowledgment) {
        EventEnvelope<Map<String, Object>> event;
        try {
            event = objectMapper.readValue(payload, new TypeReference<EventEnvelope<Map<String, Object>>>() {});
        } catch (JsonProcessingException e) {
            log.error("Fatal deserialization error in partial projection updater — skipping: {}", e.getMessage());
            acknowledgment.acknowledge();
            return;
        }

        try {
            Map<String, Object> data = event.data();
            UUID key = objectMapper.convertValue(data.get("serviceId"), UUID.class);
            if (key == null) {
                log.warn(
                    "Partial projection event for ServiceMetrics (ServiceLatencyUpdated) missing keyBy field serviceId — discarding"
                );
                acknowledgment.acknowledge();
                return;
            }

            Optional<ServiceMetricsJpa> existing = repository.findById(key);
            if (existing.isEmpty()) {
                log.debug(
                    "Partial projection updater: key={} not found in ServiceMetrics — discarding ServiceLatencyUpdated (row not yet created by primary source)",
                    key
                );
                acknowledgment.acknowledge();
                return;
            }

            ServiceMetricsJpa row = existing.get();
            row.setAverageLatency(objectMapper.convertValue(data.get("averageLatency"), Duration.class));
            row.setScore(objectMapper.convertValue(data.get("score"), BigDecimal.class));
            row.setLastUpdatedAt(Instant.now());
            repository.save(row);

            acknowledgment.acknowledge();
        } catch (RuntimeException e) {
            log.warn("Partial projection updater error — will retry. error={}", e.getMessage(), e);
            throw e;
        }
    }
}
