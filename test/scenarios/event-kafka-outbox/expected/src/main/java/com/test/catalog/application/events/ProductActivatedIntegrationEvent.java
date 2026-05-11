package com.test.catalog.application.events;

import com.test.shared.domain.EventMetadata;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * Integration Event — broker-side projection of the {@link com.test.catalog.domain.events.ProductActivatedEvent} domain event.
 *
 * Intentionally decoupled from the domain event so that changes in broker
 * technology or serialization format never affect the domain model.
 *
 * channel: catalog.product.activated
 * version: 1
 * derived_from: domainEvents.published.ProductActivated
 */
public record ProductActivatedIntegrationEvent(
    EventMetadata metadata,

    UUID productId,
    String productName,
    BigDecimal price
) {}
