package com.test.sales.domain.aggregate;

import com.test.sales.domain.enums.OrderStatus;
import com.test.sales.domain.valueobject.Money;
import java.util.UUID;

/**
 * Order — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Order {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private Money totalAmount;
    private OrderStatus status;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Order(UUID id, Money totalAmount, OrderStatus status) {
        this.id = id;
        this.totalAmount = totalAmount;
        this.status = status;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public Money getTotalAmount() {
        return totalAmount;
    }

    public OrderStatus getStatus() {
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
