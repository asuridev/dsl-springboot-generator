package com.test.catalog.application.events;

import com.test.shared.domain.EventMetadata;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * Integration Event — broker-side projection of the {@link com.test.catalog.domain.events.StockInitializedEvent} domain event.
 *
 * Intentionally decoupled from the domain event so that changes in broker
 * technology or serialization format never affect the domain model.
 *
 * channel: catalog.product.stock-initialized
 * version: 1
 * derived_from: domainEvents.published.StockInitialized
 */
public record StockInitializedIntegrationEvent(
    EventMetadata metadata,

    UUID productId,
    Integer quantity,
    Integer reservedQuantity,
    BigDecimal unitCost
) {}
