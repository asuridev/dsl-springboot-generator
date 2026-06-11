package com.test.monitoring.domain.aggregate;

import java.util.UUID;

/**
 * ServiceCheck — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class ServiceCheck {

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
