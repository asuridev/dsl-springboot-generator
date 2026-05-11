package com.test.orders.domain.aggregate;

import java.util.UUID;

/**
 * Order — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Order {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String status;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Order(UUID id, String status) {
        this.id = id;
        this.status = status;
    }

    // ─── Creation constructor (new Order) ───────────────────────────────
    private Order(String status) {
        this.id = UUID.randomUUID();
        this.status = status;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public String getStatus() {
        return status;
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
