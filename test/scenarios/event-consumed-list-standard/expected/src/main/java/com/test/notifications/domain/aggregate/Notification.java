package com.test.notifications.domain.aggregate;

import java.util.List;
import java.util.UUID;

/**
 * Notification — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Notification {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private UUID shipmentId;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Notification(UUID id, UUID shipmentId) {
        this.id = id;
        this.shipmentId = shipmentId;
    }

    // ─── Creation constructor (new Notification) ───────────────────────────────
    private Notification(UUID shipmentId) {
        this.id = UUID.randomUUID();
        this.shipmentId = shipmentId;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public UUID getShipmentId() {
        return shipmentId;
    }

    // ─── Business methods ─────────────────────────────────────────────────────

    /** derived_from: notify-shipment-dispatched NotifyShipmentDispatched */
    public void notify(UUID shipmentId, List<UUID> productIds, List<Instant> checkpointTimes) {
        // TODO: implement business logic — ver notifications-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Notification that = (Notification) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Notification{id=" + this.id + "}";
    }
}
