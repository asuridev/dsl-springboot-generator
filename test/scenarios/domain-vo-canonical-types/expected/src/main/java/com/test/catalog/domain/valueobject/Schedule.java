package com.test.catalog.domain.valueobject;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;

/**
 * Schedule — Value Object
 * Immutable domain value object (pure Java, no Lombok).
 *
 * Covers Boolean, Date, and DateTime canonical types.
 *
 * derived_from: valueObject:Schedule
 */
public final class Schedule {

    private final Boolean active;

    private final LocalDate startDate;

    private final Instant publishedAt;

    public Schedule(Boolean active, LocalDate startDate, Instant publishedAt) {
        if (active == null) {
            throw new IllegalArgumentException("VO Schedule.active: required");
        }
        if (startDate == null) {
            throw new IllegalArgumentException("VO Schedule.startDate: required");
        }

        this.active = active;
        this.startDate = startDate;
        this.publishedAt = publishedAt;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public Boolean getActive() {
        return active;
    }

    public LocalDate getStartDate() {
        return startDate;
    }

    public Instant getPublishedAt() {
        return publishedAt;
    }

    // ─── Structural equality ──────────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Schedule that = (Schedule) o;
        return (
            Objects.equals(active, that.active) &&
            Objects.equals(startDate, that.startDate) &&
            Objects.equals(publishedAt, that.publishedAt)
        );
    }

    @Override
    public int hashCode() {
        return Objects.hash(active, startDate, publishedAt);
    }

    @Override
    public String toString() {
        return "Schedule{" + "active=" + active + ", startDate=" + startDate + ", publishedAt=" + publishedAt + '}';
    }
}
