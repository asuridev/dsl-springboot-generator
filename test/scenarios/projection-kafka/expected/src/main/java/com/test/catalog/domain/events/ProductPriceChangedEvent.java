package com.test.catalog.domain.events;

import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * Domain event: ProductPriceChanged.
 * Immutable record representing something that happened in the catalog bounded context.
 *
 * channel: catalog.product.price.changed
 * version: 1
 * derived_from: domainEvents.published.ProductPriceChanged
 */
public record ProductPriceChangedEvent(
    EventMetadata metadata,

    UUID productId,

    BigDecimal newPrice
) implements DomainEvent {}
