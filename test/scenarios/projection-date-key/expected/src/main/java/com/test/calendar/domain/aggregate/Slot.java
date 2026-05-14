package com.test.calendar.domain.aggregate;

import com.test.calendar.domain.events.SlotCapacityPublishedEvent;
import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * Slot — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Slot {

    // ─── Domain Events ────────────────────────────────────────────────────────

    private final List<DomainEvent> _domainEvents = new ArrayList<>();

    protected void raise(DomainEvent event) {
        _domainEvents.add(event);
    }

    public List<DomainEvent> pullDomainEvents() {
        List<DomainEvent> events = Collections.unmodifiableList(new ArrayList<>(_domainEvents));
        _domainEvents.clear();
        return events;
    }

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private LocalDate slotDate;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Slot(UUID id, LocalDate slotDate) {
        this.id = id;
        this.slotDate = slotDate;
    }

    // ─── Creation constructor (new Slot) ───────────────────────────────
    private Slot(LocalDate slotDate) {
        this.id = UUID.randomUUID();
        this.slotDate = slotDate;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public LocalDate getSlotDate() {
        return slotDate;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Slot that = (Slot) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Slot{id=" + this.id + "}";
    }
}
