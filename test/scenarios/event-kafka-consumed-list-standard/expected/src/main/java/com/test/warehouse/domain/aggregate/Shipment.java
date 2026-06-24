package com.test.warehouse.domain.aggregate;

import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import com.test.warehouse.domain.events.ShipmentDispatchedEvent;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * Shipment — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Shipment {

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

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Shipment(UUID id) {
        this.id = id;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    // ─── Business methods ─────────────────────────────────────────────────────

    /** derived_from: dispatch-shipment DispatchShipment */
    public void dispatch(List<UUID> productIds, List<Instant> checkpointTimes) {
        // TODO: implement business logic — ver warehouse-flows.md
        // derived_from: domainEvents.published.ShipmentDispatched
        raise(
            new ShipmentDispatchedEvent(
                EventMetadata.now("ShipmentDispatched", 1, "warehouse"),
                this.getId(),
                productIds,
                checkpointTimes
            )
        );
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Shipment that = (Shipment) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Shipment{id=" + this.id + "}";
    }
}
