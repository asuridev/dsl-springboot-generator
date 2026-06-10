package com.test.payments.domain.aggregate;

import java.util.UUID;

/**
 * Payment — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Payment {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String status;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Payment(UUID id, String status) {
        this.id = id;
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
