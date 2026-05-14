package com.test.booking.domain.aggregate;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Reservation — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Reservation {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private LocalDate date;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Reservation(UUID id, LocalDate date) {
        this.id = id;
        this.date = date;
    }

    // ─── Creation constructor (new Reservation) ───────────────────────────────
    private Reservation(LocalDate date) {
        this.id = UUID.randomUUID();
        this.date = date;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public LocalDate getDate() {
        return date;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Reservation that = (Reservation) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Reservation{id=" + this.id + "}";
    }
}
