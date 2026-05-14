package com.test.warehouse.domain.events;

import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Domain event: ShipmentDispatched.
 * Immutable record representing something that happened in the warehouse bounded context.
 *
 * channel: warehouse.shipment.dispatched
 * version: 1
 * derived_from: domainEvents.published.ShipmentDispatched
 */
public record ShipmentDispatchedEvent(
    EventMetadata metadata,

    UUID shipmentId,

    List<UUID> productIds,

    List<Instant> checkpointTimes
) implements DomainEvent {}
