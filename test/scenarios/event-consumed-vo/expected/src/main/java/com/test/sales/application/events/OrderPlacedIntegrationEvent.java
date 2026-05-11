package com.test.sales.application.events;

import com.test.sales.domain.valueobject.OrderLineSnapshot;
import com.test.shared.domain.EventMetadata;
import java.util.List;
import java.util.UUID;

/**
 * Integration Event — broker-side projection of the {@link com.test.sales.domain.events.OrderPlacedEvent} domain event.
 *
 * Intentionally decoupled from the domain event so that changes in broker
 * technology or serialization format never affect the domain model.
 *
 * channel: sales.order.placed
 * version: 1
 * derived_from: domainEvents.published.OrderPlaced
 */
public record OrderPlacedIntegrationEvent(
    EventMetadata metadata,

    UUID orderId,
    UUID buyerId,
    List<OrderLineSnapshot> lines
) {}
