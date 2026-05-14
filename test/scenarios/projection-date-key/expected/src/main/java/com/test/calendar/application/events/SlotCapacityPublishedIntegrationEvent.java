package com.test.calendar.application.events;

import com.test.shared.domain.EventMetadata;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * Integration Event — broker-side projection of the {@link com.test.calendar.domain.events.SlotCapacityPublishedEvent} domain event.
 *
 * Intentionally decoupled from the domain event so that changes in broker
 * technology or serialization format never affect the domain model.
 *
 * channel: calendar.slot.capacity-published
 * version: 1
 * derived_from: domainEvents.published.SlotCapacityPublished
 */
public record SlotCapacityPublishedIntegrationEvent(
    EventMetadata metadata,

    LocalDate date,
    Integer totalSlots,
    Integer bookedSlots
) {}
