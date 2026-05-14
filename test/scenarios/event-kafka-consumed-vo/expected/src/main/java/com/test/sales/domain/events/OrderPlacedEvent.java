package com.test.sales.domain.events;

import com.test.sales.domain.enums.OrderStatus;
import com.test.sales.domain.valueobject.Money;
import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.util.UUID;

/**
 * Domain event: OrderPlaced.
 * Immutable record representing something that happened in the sales bounded context.
 *
 * channel: sales.order.placed
 * version: 1
 * derived_from: domainEvents.published.OrderPlaced
 */
public record OrderPlacedEvent(
    EventMetadata metadata,

    UUID orderId,

    Money totalAmount,

    OrderStatus status
) implements DomainEvent {}
