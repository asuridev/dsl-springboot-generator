package com.test.inventory.domain.aggregate;

import java.util.UUID;

/**
 * StockEntry — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class StockEntry {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public StockEntry(UUID id) {
        this.id = id;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        StockEntry that = (StockEntry) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "StockEntry{id=" + this.id + "}";
    }
}
