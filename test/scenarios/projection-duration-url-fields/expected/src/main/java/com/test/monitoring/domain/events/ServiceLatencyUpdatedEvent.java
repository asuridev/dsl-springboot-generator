package com.test.monitoring.domain.events;

import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.UUID;

/**
 * Domain event: ServiceLatencyUpdated.
 * Immutable record representing something that happened in the monitoring bounded context.
 *
 * channel: monitoring.service-check.latency-updated
 * version: 1
 * derived_from: domainEvents.published.ServiceLatencyUpdated
 */
public record ServiceLatencyUpdatedEvent(
    EventMetadata metadata,

    UUID serviceId,

    Duration averageLatency,

    BigDecimal score
) implements DomainEvent {}
