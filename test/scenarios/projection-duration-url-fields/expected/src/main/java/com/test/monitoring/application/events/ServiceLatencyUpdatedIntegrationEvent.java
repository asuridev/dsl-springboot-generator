package com.test.monitoring.application.events;

import com.test.shared.domain.EventMetadata;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.UUID;

/**
 * Integration Event — broker-side projection of the {@link com.test.monitoring.domain.events.ServiceLatencyUpdatedEvent} domain event.
 *
 * Intentionally decoupled from the domain event so that changes in broker
 * technology or serialization format never affect the domain model.
 *
 * channel: monitoring.service-check.latency-updated
 * version: 1
 * derived_from: domainEvents.published.ServiceLatencyUpdated
 */
public record ServiceLatencyUpdatedIntegrationEvent(
    EventMetadata metadata,

    UUID serviceId,
    Duration averageLatency,
    BigDecimal score
) {}
