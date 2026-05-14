package com.test.calendar.domain.events;

import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.time.LocalDate;

/**
 * Domain event: SlotCapacityPublished.
 * Immutable record representing something that happened in the calendar bounded context.
 *
 * channel: calendar.slot.capacity-published
 * version: 1
 * derived_from: domainEvents.published.SlotCapacityPublished
 */
public record SlotCapacityPublishedEvent(
    EventMetadata metadata,

    LocalDate date,

    Integer totalSlots,

    Integer bookedSlots
) implements DomainEvent {}
