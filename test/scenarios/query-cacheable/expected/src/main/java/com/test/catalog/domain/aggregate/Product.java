package com.test.catalog.domain.aggregate;

import java.time.Instant;
import java.util.UUID;

/**
 * Product — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Product {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String name;
    private UUID categoryId;
    private String status;

    private Instant createdAt;
    private Instant updatedAt;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Product(UUID id, String name, UUID categoryId, String status, Instant createdAt, Instant updatedAt) {
        this.id = id;
        this.name = name;
        this.categoryId = categoryId;
        this.status = status;

        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    // ─── Creation constructor (new Product) ───────────────────────────────
    private Product(String name, UUID categoryId, String status) {
        this.id = UUID.randomUUID();
        this.name = name;
        this.categoryId = categoryId;
        this.status = status;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public UUID getCategoryId() {
        return categoryId;
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

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Product that = (Product) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Product{id=" + this.id + "}";
    }
}
