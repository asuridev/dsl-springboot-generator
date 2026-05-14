package com.test.inventory.infrastructure.projectionUpdaters;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.test.inventory.infrastructure.persistence.projections.ProductStockJpa;
import com.test.inventory.infrastructure.persistence.projections.ProductStockJpaRepository;
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
 * Partial projection updater for ProductStock — handles StockReserved.
 * Only updates fields: reservedQuantity.
 * Never inserts new rows — if the key does not exist, the event is discarded.
 * derived_from: bc.inventory.projections[ProductStock].additionalSources[event=StockReserved]
 * upsertStrategy: versionGuarded (inherited from projection)
 */
@Component("inventory.ProductStockOnStockReservedProjectionUpdater")
public class ProductStockOnStockReservedProjectionUpdater {

    private static final Logger log = LoggerFactory.getLogger(ProductStockOnStockReservedProjectionUpdater.class);

    private final ProductStockJpaRepository repository;
    private final ObjectMapper objectMapper;

    public ProductStockOnStockReservedProjectionUpdater(
        ProductStockJpaRepository repository,
        ObjectMapper objectMapper
    ) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(
        topics = "${topics.inventory-projection-product-stock-stock-reserved}",
        groupId = "${spring.application.name}-ProductStockOnStockReserved"
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
                    "Partial projection event for ProductStock (StockReserved) missing keyBy field productId — discarding"
                );
                acknowledgment.acknowledge();
                return;
            }

            Optional<ProductStockJpa> existing = repository.findById(key);
            if (existing.isEmpty()) {
                log.debug(
                    "Partial projection updater: key={} not found in ProductStock — discarding StockReserved (row not yet created by primary source)",
                    key
                );
                acknowledgment.acknowledge();
                return;
            }

            BigDecimal incomingVersion = objectMapper.convertValue(data.get("unitCost"), BigDecimal.class);
            if (
                incomingVersion != null &&
                existing.get().getUnitCost() != null &&
                incomingVersion.compareTo(existing.get().getUnitCost()) <= 0
            ) {
                log.debug(
                    "Skipping stale partial projection update for ProductStock (StockReserved) key={} (incoming v{} <= stored v{})",
                    key,
                    incomingVersion,
                    existing.get().getUnitCost()
                );
                acknowledgment.acknowledge();
                return;
            }

            ProductStockJpa row = existing.get();
            row.setReservedQuantity(objectMapper.convertValue(data.get("reservedQuantity"), Integer.class));
            row.setLastUpdatedAt(Instant.now());
            repository.save(row);

            acknowledgment.acknowledge();
        } catch (RuntimeException e) {
            log.warn("Partial projection updater error — will retry. error={}", e.getMessage(), e);
            throw e;
        }
    }
}
