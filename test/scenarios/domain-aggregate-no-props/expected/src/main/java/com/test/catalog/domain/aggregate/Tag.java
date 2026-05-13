package com.test.catalog.domain.aggregate;

import java.time.Instant;
import java.util.UUID;

/**
 * Tag — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Tag {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;

    private Instant createdAt;
    private Instant updatedAt;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Tag(UUID id, Instant createdAt, Instant updatedAt) {
        this.id = id;

        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    // ─── Creation constructor (new Tag) ───────────────────────────────
    private Tag() {
        this.id = UUID.randomUUID();
    }

    // ─── Static factory ───────────────────────────────────────────────────────

    /** derived_from: UC-TAG-001 CreateTag */
    public static Tag create() {
        Tag instance = new Tag();
        return instance;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Tag that = (Tag) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Tag{id=" + this.id + "}";
    }
}
