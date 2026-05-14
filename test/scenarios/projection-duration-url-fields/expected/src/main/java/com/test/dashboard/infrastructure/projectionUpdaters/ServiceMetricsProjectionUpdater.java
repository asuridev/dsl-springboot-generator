package com.test.dashboard.infrastructure.projectionUpdaters;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.test.dashboard.infrastructure.persistence.projections.ServiceMetricsJpa;
import com.test.dashboard.infrastructure.persistence.projections.ServiceMetricsJpaRepository;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import java.math.BigDecimal;
import java.net.URI;
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
 * Persistent projection updater for ServiceMetrics.
 * Subscribes to monitoring.service-check-completed and upserts the local read model.
 * derived_from: bc.dashboard.projections[ServiceMetrics] (persistent: true)
 * upsertStrategy: lastWriteWins
 */
@Component("dashboard.ServiceMetricsProjectionUpdater")
public class ServiceMetricsProjectionUpdater {

    private static final Logger log = LoggerFactory.getLogger(ServiceMetricsProjectionUpdater.class);

    private final ServiceMetricsJpaRepository repository;
    private final ObjectMapper objectMapper;

    public ServiceMetricsProjectionUpdater(ServiceMetricsJpaRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(
        topics = "${topics.dashboard-projection-service-metrics-service-check-completed}",
        groupId = "${spring.application.name}-ServiceMetrics"
    )
    @Transactional
    public void handle(String payload, Acknowledgment acknowledgment) {
        EventEnvelope<Map<String, Object>> event;
        try {
            event = objectMapper.readValue(payload, new TypeReference<EventEnvelope<Map<String, Object>>>() {});
        } catch (JsonProcessingException e) {
            log.error("Fatal deserialization error in projection updater — skipping: {}", e.getMessage());
            acknowledgment.acknowledge();
            return;
        }

        try {
            Map<String, Object> data = event.data();
            UUID key = objectMapper.convertValue(data.get("serviceId"), UUID.class);
            if (key == null) {
                log.warn("Projection event for ServiceMetrics missing keyBy field serviceId — discarding");
                acknowledgment.acknowledge();
                return;
            }

            Optional<ServiceMetricsJpa> existing = repository.findById(key);

            ServiceMetricsJpa row = existing.orElseGet(ServiceMetricsJpa::new);
            row.setServiceId(key);
            row.setAverageLatency(objectMapper.convertValue(data.get("averageLatency"), Duration.class));
            row.setDashboardUrl(objectMapper.convertValue(data.get("dashboardUrl"), URI.class));
            row.setScore(objectMapper.convertValue(data.get("score"), BigDecimal.class));
            row.setLastUpdatedAt(Instant.now());
            repository.save(row);

            acknowledgment.acknowledge();
        } catch (RuntimeException e) {
            log.warn("Projection updater error — will retry. error={}", e.getMessage(), e);
            throw e;
        }
    }
}
