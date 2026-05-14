package com.test.inventory.domain.events;

import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.util.UUID;

/**
 * Domain event: StockReserved.
 * Immutable record representing something that happened in the inventory bounded context.
 *
 * channel: inventory.stock.reserved
 * version: 1
 * derived_from: domainEvents.published.StockReserved
 */
public record StockReservedEvent(EventMetadata metadata, UUID orderId) implements DomainEvent {}
