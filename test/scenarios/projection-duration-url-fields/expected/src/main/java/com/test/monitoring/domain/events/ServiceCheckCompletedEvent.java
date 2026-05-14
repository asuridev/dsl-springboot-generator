package com.test.monitoring.domain.events;

import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Duration;
import java.util.UUID;

/**
 * Domain event: ServiceCheckCompleted.
 * Immutable record representing something that happened in the monitoring bounded context.
 *
 * channel: monitoring.service-check.completed
 * version: 1
 * derived_from: domainEvents.published.ServiceCheckCompleted
 */
public record ServiceCheckCompletedEvent(
    EventMetadata metadata,

    UUID serviceId,

    Duration averageLatency,

    URI dashboardUrl,

    BigDecimal score
) implements DomainEvent {}
