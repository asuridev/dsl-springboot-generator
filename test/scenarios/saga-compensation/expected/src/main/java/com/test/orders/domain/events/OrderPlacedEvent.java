package com.test.orders.domain.events;

import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.util.UUID;

/**
 * Domain event: OrderPlaced.
 * Immutable record representing something that happened in the orders bounded context.
 *
 * channel: orders.order.placed
 * version: 1
 * derived_from: domainEvents.published.OrderPlaced
 */
public record OrderPlacedEvent(EventMetadata metadata, UUID orderId, UUID customerId) implements DomainEvent {}
