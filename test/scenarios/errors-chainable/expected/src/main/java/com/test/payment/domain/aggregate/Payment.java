package com.test.payment.domain.aggregate;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Payment — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Payment {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private BigDecimal amount;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Payment(UUID id, BigDecimal amount) {
        this.id = id;
        this.amount = amount;
    }

    // ─── Creation constructor (new Payment) ───────────────────────────────
    private Payment(BigDecimal amount) {
        this.id = UUID.randomUUID();
        this.amount = amount;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Payment that = (Payment) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Payment{id=" + this.id + "}";
    }
}
