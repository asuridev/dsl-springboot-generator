package com.test.catalog.domain.events;

import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * Domain event: StockInitialized.
 * Immutable record representing something that happened in the catalog bounded context.
 *
 * channel: catalog.product.stock-initialized
 * version: 1
 * derived_from: domainEvents.published.StockInitialized
 */
public record StockInitializedEvent(
    EventMetadata metadata,

    UUID productId,

    Integer quantity,

    Integer reservedQuantity,

    BigDecimal unitCost
) implements DomainEvent {}
