package com.test.orders.domain.aggregate;

import com.test.orders.domain.events.OrderPlacedEvent;
import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * Order — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Order {

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
    private UUID customerId;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Order(UUID id, UUID customerId) {
        this.id = id;
        this.customerId = customerId;
    }

    // ─── Creation constructor (new Order) ───────────────────────────────
    private Order(UUID customerId) {
        this.id = UUID.randomUUID();
        this.customerId = customerId;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public UUID getCustomerId() {
        return customerId;
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
