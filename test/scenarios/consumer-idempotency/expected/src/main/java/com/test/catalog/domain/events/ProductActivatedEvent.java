package com.test.catalog.domain.events;

import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * Domain event: ProductActivated.
 * Immutable record representing something that happened in the catalog bounded context.
 *
 * channel: catalog.product.activated
 * version: 1
 * derived_from: domainEvents.published.ProductActivated
 */
public record ProductActivatedEvent(
    EventMetadata metadata,

    UUID productId,

    String productName,

    BigDecimal price
) implements DomainEvent {}
