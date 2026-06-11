package com.test.sales.domain.aggregate;

import java.util.UUID;

/**
 * SalesOrder — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class SalesOrder {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private UUID buyerId;
    private String status;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public SalesOrder(UUID id, UUID buyerId, String status) {
        this.id = id;
        this.buyerId = buyerId;
        this.status = status;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public UUID getBuyerId() {
        return buyerId;
    }

    public String getStatus() {
        return status;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        SalesOrder that = (SalesOrder) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "SalesOrder{id=" + this.id + "}";
    }
}
