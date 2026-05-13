package com.test.invoice.domain.aggregate;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Invoice — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Invoice {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String number;
    private BigDecimal amount;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Invoice(UUID id, String number, BigDecimal amount) {
        this.id = id;
        this.number = number;
        this.amount = amount;
    }

    // ─── Creation constructor (new Invoice) ───────────────────────────────
    private Invoice(String number, BigDecimal amount) {
        this.id = UUID.randomUUID();
        this.number = number;
        this.amount = amount;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public String getNumber() {
        return number;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Invoice that = (Invoice) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Invoice{id=" + this.id + "}";
    }
}
