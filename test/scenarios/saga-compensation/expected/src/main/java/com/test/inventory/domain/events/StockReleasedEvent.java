package com.test.inventory.domain.events;

import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.util.UUID;

/**
 * Domain event: StockReleased.
 * Immutable record representing something that happened in the inventory bounded context.
 *
 * channel: inventory.stock.released
 * version: 1
 * derived_from: domainEvents.published.StockReleased
 */
public record StockReleasedEvent(EventMetadata metadata, UUID orderId) implements DomainEvent {}
