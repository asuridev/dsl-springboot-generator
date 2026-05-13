package com.test.subscription.domain.aggregate;

import java.util.UUID;

/**
 * Subscription — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Subscription {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String plan;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Subscription(UUID id, String plan) {
        this.id = id;
        this.plan = plan;
    }

    // ─── Creation constructor (new Subscription) ───────────────────────────────
    private Subscription(String plan) {
        this.id = UUID.randomUUID();
        this.plan = plan;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public String getPlan() {
        return plan;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Subscription that = (Subscription) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Subscription{id=" + this.id + "}";
    }
}
