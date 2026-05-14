package com.test.orders.infrastructure.projectionUpdaters;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.test.orders.infrastructure.persistence.projections.LocalProductViewJpa;
import com.test.orders.infrastructure.persistence.projections.LocalProductViewJpaRepository;
import com.test.shared.infrastructure.eventEnvelope.EventEnvelope;
import java.math.BigDecimal;
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
 * Persistent projection updater for LocalProductView.
 * Subscribes to catalog.product-activated and upserts the local read model.
 * derived_from: bc.orders.projections[LocalProductView] (persistent: true)
 * upsertStrategy: lastWriteWins
 */
@Component("orders.LocalProductViewProjectionUpdater")
public class LocalProductViewProjectionUpdater {

    private static final Logger log = LoggerFactory.getLogger(LocalProductViewProjectionUpdater.class);

    private final LocalProductViewJpaRepository repository;
    private final ObjectMapper objectMapper;

    public LocalProductViewProjectionUpdater(LocalProductViewJpaRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(
        topics = "${topics.orders-projection-local-product-view-product-activated}",
        groupId = "${spring.application.name}-LocalProductView"
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
            UUID key = objectMapper.convertValue(data.get("productId"), UUID.class);
            if (key == null) {
                log.warn("Projection event for LocalProductView missing keyBy field productId — discarding");
                acknowledgment.acknowledge();
                return;
            }

            Optional<LocalProductViewJpa> existing = repository.findById(key);

            LocalProductViewJpa row = existing.orElseGet(LocalProductViewJpa::new);
            row.setProductId(key);
            row.setProductName(objectMapper.convertValue(data.get("productName"), String.class));
            row.setPrice(objectMapper.convertValue(data.get("price"), BigDecimal.class));
            row.setLastUpdatedAt(Instant.now());
            repository.save(row);

            acknowledgment.acknowledge();
        } catch (RuntimeException e) {
            log.warn("Projection updater error — will retry. error={}", e.getMessage(), e);
            throw e;
        }
    }
}
