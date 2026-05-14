package com.test.inventory.application.events;

import com.test.shared.domain.EventMetadata;
import java.util.UUID;

/**
 * Integration Event — broker-side projection of the {@link com.test.inventory.domain.events.StockReleasedEvent} domain event.
 *
 * Intentionally decoupled from the domain event so that changes in broker
 * technology or serialization format never affect the domain model.
 *
 * channel: inventory.stock.released
 * version: 1
 * derived_from: domainEvents.published.StockReleased
 */
public record StockReleasedIntegrationEvent(EventMetadata metadata, UUID orderId) {}
