package com.test.catalog.domain.events;

import com.test.shared.domain.DomainEvent;
import com.test.catalog.domain.valueobject.undefined;import com.test.shared.domain.EventMetadata;import java.util.UUID;

/**
 * Domain event: ProductCreated.
 * Immutable record representing something that happened in the catalog bounded context.
 *
 * channel: catalog.product.created
 * version: 1
 * derived_from: domainEvents.published.ProductCreated
 */
public record ProductCreatedEvent(
        EventMetadata metadata,

        UUID productId,

        String productName,

         issuedAt

) implements DomainEvent {}
