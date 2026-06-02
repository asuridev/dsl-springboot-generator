package com.test.orders.domain.aggregate;

import com.test.orders.domain.enums.CartStatus;
import java.util.UUID;

/**
 * Cart — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Cart {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private UUID customerId;
    private CartStatus status;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Cart(UUID id, UUID customerId, CartStatus status) {
        this.id = id;
        this.customerId = customerId;
        this.status = status;
    }

    // ─── Creation constructor (new Cart) ───────────────────────────────
    private Cart(UUID customerId, CartStatus status) {
        this.id = UUID.randomUUID();
        this.customerId = customerId;
        this.status = status;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public UUID getCustomerId() {
        return customerId;
    }

    public CartStatus getStatus() {
        return status;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Cart that = (Cart) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Cart{id=" + this.id + "}";
    }
}
