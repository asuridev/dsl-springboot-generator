package com.test.catalog.domain.aggregate;

import java.time.Instant;
import java.util.UUID;

/**
 * Category — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Category {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String name;
    private UUID parentId;

    private Instant createdAt;
    private Instant updatedAt;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Category(UUID id, String name, UUID parentId, Instant createdAt, Instant updatedAt) {
        this.id = id;
        this.name = name;
        this.parentId = parentId;

        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    // ─── Creation constructor (new Category) ───────────────────────────────
    private Category(String name, UUID parentId) {
        this.id = UUID.randomUUID();
        this.name = name;
        this.parentId = parentId;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public UUID getParentId() {
        return parentId;
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
        Category that = (Category) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Category{id=" + this.id + "}";
    }
}
