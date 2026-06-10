package com.test.products.domain.aggregate;

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
    private String status;

    private Instant createdAt;
    private Instant updatedAt;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Product(UUID id, String name, String status, Instant createdAt, Instant updatedAt) {
        this.id = id;
        this.name = name;
        this.status = status;

        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    // ─── Creation constructor (new Product) ───────────────────────────────
    // Identity is assigned at the application edge (controller) and propagated
    // here via the command/factory — not generated inside the domain.
    private Product(UUID id, String name, String status) {
        this.id = id;
        this.name = name;
        this.status = status;
    }

    // ─── Static factory ───────────────────────────────────────────────────────

    /** derived_from: UC-PRD-001 CreateProduct */
    public static Product create(UUID id) {
        Product instance = new Product(id, null /* TODO: compute name */, null /* TODO: compute status */);
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
