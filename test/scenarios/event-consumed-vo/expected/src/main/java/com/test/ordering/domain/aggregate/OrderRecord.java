package com.test.ordering.domain.aggregate;

import com.test.ordering.application.dtos.incoming.OrderLineSnapshot;
import java.util.List;
import java.util.UUID;

/**
 * OrderRecord — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class OrderRecord {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private UUID buyerId;
    private String status;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public OrderRecord(UUID id, UUID buyerId, String status) {
        this.id = id;
        this.buyerId = buyerId;
        this.status = status;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public UUID getBuyerId() {
        return buyerId;
    }

    public String getStatus() {
        return status;
    }

    // ─── Business methods ─────────────────────────────────────────────────────

    /** derived_from: process-placed-order ProcessPlacedOrder */
    public void process(List<OrderLineSnapshot> lines) {
        // TODO: implement business logic — ver ordering-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        OrderRecord that = (OrderRecord) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "OrderRecord{id=" + this.id + "}";
    }
}
