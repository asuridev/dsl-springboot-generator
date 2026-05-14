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
 * Partial projection updater for LocalProductView — handles ProductPriceChanged.
 * Only updates fields: price.
 * Never inserts new rows — if the key does not exist, the event is discarded.
 * derived_from: bc.orders.projections[LocalProductView].additionalSources[event=ProductPriceChanged]
 * upsertStrategy: lastWriteWins (inherited from projection)
 */
@Component("orders.LocalProductViewOnProductPriceChangedProjectionUpdater")
public class LocalProductViewOnProductPriceChangedProjectionUpdater {

    private static final Logger log = LoggerFactory.getLogger(
        LocalProductViewOnProductPriceChangedProjectionUpdater.class
    );

    private final LocalProductViewJpaRepository repository;
    private final ObjectMapper objectMapper;

    public LocalProductViewOnProductPriceChangedProjectionUpdater(
        LocalProductViewJpaRepository repository,
        ObjectMapper objectMapper
    ) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(
        topics = "${topics.orders-projection-local-product-view-product-price-changed}",
        groupId = "${spring.application.name}-LocalProductViewOnProductPriceChanged"
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
            UUID key = objectMapper.convertValue(data.get("productId"), UUID.class);
            if (key == null) {
                log.warn(
                    "Partial projection event for LocalProductView (ProductPriceChanged) missing keyBy field productId — discarding"
                );
                acknowledgment.acknowledge();
                return;
            }

            Optional<LocalProductViewJpa> existing = repository.findById(key);
            if (existing.isEmpty()) {
                log.debug(
                    "Partial projection updater: key={} not found in LocalProductView — discarding ProductPriceChanged (row not yet created by primary source)",
                    key
                );
                acknowledgment.acknowledge();
                return;
            }

            LocalProductViewJpa row = existing.get();
            row.setPrice(objectMapper.convertValue(data.get("price"), BigDecimal.class));
            row.setLastUpdatedAt(Instant.now());
            repository.save(row);

            acknowledgment.acknowledge();
        } catch (RuntimeException e) {
            log.warn("Partial projection updater error — will retry. error={}", e.getMessage(), e);
            throw e;
        }
    }
}
