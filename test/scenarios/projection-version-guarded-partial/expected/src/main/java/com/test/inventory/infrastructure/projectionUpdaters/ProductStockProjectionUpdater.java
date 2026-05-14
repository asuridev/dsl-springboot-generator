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
 * Persistent projection updater for ProductStock.
 * Subscribes to catalog.stock-initialized and upserts the local read model.
 * derived_from: bc.inventory.projections[ProductStock] (persistent: true)
 * upsertStrategy: versionGuarded
 */
@Component("inventory.ProductStockProjectionUpdater")
public class ProductStockProjectionUpdater {

    private static final Logger log = LoggerFactory.getLogger(ProductStockProjectionUpdater.class);

    private final ProductStockJpaRepository repository;
    private final ObjectMapper objectMapper;

    public ProductStockProjectionUpdater(ProductStockJpaRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(
        topics = "${topics.inventory-projection-product-stock-stock-initialized}",
        groupId = "${spring.application.name}-ProductStock"
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
                log.warn("Projection event for ProductStock missing keyBy field productId — discarding");
                acknowledgment.acknowledge();
                return;
            }

            Optional<ProductStockJpa> existing = repository.findById(key);

            BigDecimal incomingVersion = objectMapper.convertValue(data.get("unitCost"), BigDecimal.class);
            if (
                existing.isPresent() &&
                incomingVersion != null &&
                existing.get().getUnitCost() != null &&
                incomingVersion.compareTo(existing.get().getUnitCost()) <= 0
            ) {
                log.debug(
                    "Skipping stale projection update for ProductStock key={} (incoming v{} <= stored v{})",
                    key,
                    incomingVersion,
                    existing.get().getUnitCost()
                );
                acknowledgment.acknowledge();
                return;
            }

            ProductStockJpa row = existing.orElseGet(ProductStockJpa::new);
            row.setProductId(key);
            row.setQuantity(objectMapper.convertValue(data.get("quantity"), Integer.class));
            row.setReservedQuantity(objectMapper.convertValue(data.get("reservedQuantity"), Integer.class));
            row.setUnitCost(objectMapper.convertValue(data.get("unitCost"), BigDecimal.class));
            row.setLastUpdatedAt(Instant.now());
            repository.save(row);

            acknowledgment.acknowledge();
        } catch (RuntimeException e) {
            log.warn("Projection updater error — will retry. error={}", e.getMessage(), e);
            throw e;
        }
    }
}
