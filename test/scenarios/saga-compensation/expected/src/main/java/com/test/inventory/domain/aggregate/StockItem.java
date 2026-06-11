package com.test.inventory.domain.aggregate;

import java.util.UUID;

/**
 * StockItem — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class StockItem {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private UUID orderId;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public StockItem(UUID id, UUID orderId) {
        this.id = id;
        this.orderId = orderId;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public UUID getOrderId() {
        return orderId;
    }

    // ─── Business methods ─────────────────────────────────────────────────────

    /** derived_from: reserve-stock ReserveStock */
    public void reserve(UUID orderId) {
        this.orderId = orderId;
    }

    /** derived_from: release-stock ReleaseStock */
    public void release(UUID orderId) {
        this.orderId = orderId;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        StockItem that = (StockItem) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "StockItem{id=" + this.id + "}";
    }
}
