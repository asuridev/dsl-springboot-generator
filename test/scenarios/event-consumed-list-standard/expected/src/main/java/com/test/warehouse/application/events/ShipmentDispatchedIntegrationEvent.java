package com.test.warehouse.application.events;

import com.test.shared.domain.EventMetadata;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.UUID;

/**
 * Integration Event — broker-side projection of the {@link com.test.warehouse.domain.events.ShipmentDispatchedEvent} domain event.
 *
 * Intentionally decoupled from the domain event so that changes in broker
 * technology or serialization format never affect the domain model.
 *
 * channel: warehouse.shipment.dispatched
 * version: 1
 * derived_from: domainEvents.published.ShipmentDispatched
 */
public record ShipmentDispatchedIntegrationEvent(
    EventMetadata metadata,

    UUID shipmentId,
    List<UUID> productIds,
    List<Instant> checkpointTimes
) {}
