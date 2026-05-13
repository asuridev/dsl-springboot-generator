package com.test.order.domain.aggregate;

import java.util.UUID;

/**
 * Order — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Order {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String reference;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Order(UUID id, String reference) {
        this.id = id;
        this.reference = reference;
    }

    // ─── Creation constructor (new Order) ───────────────────────────────
    private Order(String reference) {
        this.id = UUID.randomUUID();
        this.reference = reference;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public String getReference() {
        return reference;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Order that = (Order) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Order{id=" + this.id + "}";
    }
}
