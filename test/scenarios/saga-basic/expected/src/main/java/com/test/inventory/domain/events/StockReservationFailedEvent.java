package com.test.inventory.domain.events;

import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.util.UUID;

/**
 * Domain event: StockReservationFailed.
 * Immutable record representing something that happened in the inventory bounded context.
 *
 * channel: inventory.stock.reservation-failed
 * version: 1
 * derived_from: domainEvents.published.StockReservationFailed
 */
public record StockReservationFailedEvent(EventMetadata metadata, UUID orderId) implements DomainEvent {}
