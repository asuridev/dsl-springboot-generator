package com.test.catalog.application.events;

import com.test.shared.domain.EventMetadata;
import java.util.UUID;

/**
 * Integration Event — broker-side projection of the {@link com.test.catalog.domain.events.StockReservedEvent} domain event.
 *
 * Intentionally decoupled from the domain event so that changes in broker
 * technology or serialization format never affect the domain model.
 *
 * channel: catalog.product.stock-reserved
 * version: 1
 * derived_from: domainEvents.published.StockReserved
 */
public record StockReservedIntegrationEvent(EventMetadata metadata, UUID productId, Integer reservedQuantity) {}
