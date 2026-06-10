package com.test.dashboard.domain.aggregate;

import java.util.UUID;

/**
 * Widget — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Widget {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String title;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Widget(UUID id, String title) {
        this.id = id;
        this.title = title;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public String getTitle() {
        return title;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Widget that = (Widget) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Widget{id=" + this.id + "}";
    }
}
