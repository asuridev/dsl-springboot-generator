package com.test.payments.domain.aggregate;

import com.test.payments.domain.events.PaymentApprovedEvent;
import com.test.payments.domain.events.PaymentFailedEvent;
import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * Payment — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Payment {

    // ─── Domain Events ────────────────────────────────────────────────────────

    private final List<DomainEvent> _domainEvents = new ArrayList<>();

    protected void raise(DomainEvent event) {
        _domainEvents.add(event);
    }

    public List<DomainEvent> pullDomainEvents() {
        List<DomainEvent> events = Collections.unmodifiableList(new ArrayList<>(_domainEvents));
        _domainEvents.clear();
        return events;
    }

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private UUID orderId;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Payment(UUID id, UUID orderId) {
        this.id = id;
        this.orderId = orderId;
    }

    // ─── Creation constructor (new Payment) ───────────────────────────────
    private Payment(UUID orderId) {
        this.id = UUID.randomUUID();
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

    /** derived_from: process-payment ProcessPayment */
    public void process(UUID orderId) {
        this.orderId = orderId;
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
