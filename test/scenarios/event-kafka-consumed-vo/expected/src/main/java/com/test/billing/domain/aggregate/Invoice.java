package com.test.billing.domain.aggregate;

import com.test.billing.domain.enums.OrderStatus;
import com.test.billing.domain.valueobject.Money;
import java.util.UUID;

/**
 * Invoice — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Invoice {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private UUID orderId;
    private Money totalAmount;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Invoice(UUID id, UUID orderId, Money totalAmount) {
        this.id = id;
        this.orderId = orderId;
        this.totalAmount = totalAmount;
    }

    // ─── Creation constructor (new Invoice) ───────────────────────────────
    private Invoice(UUID orderId, Money totalAmount) {
        this.id = UUID.randomUUID();
        this.orderId = orderId;
        this.totalAmount = totalAmount;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public UUID getOrderId() {
        return orderId;
    }

    public Money getTotalAmount() {
        return totalAmount;
    }

    // ─── Business methods ─────────────────────────────────────────────────────

    /** derived_from: create-invoice-from-order CreateInvoiceFromOrder */
    public void process(UUID orderId, Money totalAmount, OrderStatus status) {
        // TODO: implement business logic — ver billing-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
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
