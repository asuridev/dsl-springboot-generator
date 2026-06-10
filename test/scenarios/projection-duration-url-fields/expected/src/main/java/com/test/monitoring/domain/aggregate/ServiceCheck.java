package com.test.monitoring.domain.aggregate;

import com.test.monitoring.domain.events.ServiceCheckCompletedEvent;
import com.test.monitoring.domain.events.ServiceLatencyUpdatedEvent;
import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * ServiceCheck — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class ServiceCheck {

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
    private String serviceName;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public ServiceCheck(UUID id, String serviceName) {
        this.id = id;
        this.serviceName = serviceName;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public String getServiceName() {
        return serviceName;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        ServiceCheck that = (ServiceCheck) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "ServiceCheck{id=" + this.id + "}";
    }
}
