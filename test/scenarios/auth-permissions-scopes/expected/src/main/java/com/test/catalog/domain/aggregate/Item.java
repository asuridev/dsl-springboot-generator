package com.test.catalog.domain.aggregate;

import java.time.Instant;
import java.util.UUID;

/**
 * Item — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Item {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String name;
    private String status;

    private Instant createdAt;
    private Instant updatedAt;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Item(UUID id, String name, String status, Instant createdAt, Instant updatedAt) {
        this.id = id;
        this.name = name;
        this.status = status;

        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    // ─── Creation constructor (new Item) ───────────────────────────────
    private Item(String name, String status) {
        this.id = UUID.randomUUID();
        this.name = name;
        this.status = status;
    }

    // ─── Static factory ───────────────────────────────────────────────────────

    /** derived_from: UC-CAT-002 CreateItem */
    public static Item create() {
        Item instance = new Item(null /* TODO: compute name */, null /* TODO: compute status */);
        return instance;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getStatus() {
        return status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    // ─── Business methods ─────────────────────────────────────────────────────

    /** derived_from: UC-CAT-003 UpdateItem */
    public Item update() {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }

    /** derived_from: UC-CAT-004 ArchiveItem */
    public Item archive() {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Item that = (Item) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Item{id=" + this.id + "}";
    }
}
