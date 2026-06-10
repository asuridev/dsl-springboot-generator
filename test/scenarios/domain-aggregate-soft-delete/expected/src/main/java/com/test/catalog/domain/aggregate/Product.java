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

    private Instant deletedAt;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Product(UUID id, String name, Instant deletedAt) {
        this.id = id;
        this.name = name;

        this.deletedAt = deletedAt;
    }

    // ─── Creation constructor (new Product) ───────────────────────────────
    // Identity is assigned at the application edge (controller) and propagated
    // here via the command/factory — not generated inside the domain.
    private Product(UUID id, String name) {
        this.id = id;
        this.name = name;
    }

    // ─── Static factory ───────────────────────────────────────────────────────

    /** derived_from: UC-PRD-001 CreateProduct */
    public static Product create(UUID id, String name) {
        Product instance = new Product(id, name);
        return instance;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public Instant getDeletedAt() {
        return deletedAt;
    }

    public boolean isDeleted() {
        return this.deletedAt != null;
    }

    // ─── Business methods ─────────────────────────────────────────────────────

    /** derived_from: softDelete: true */
    public void softDelete() {
        this.deletedAt = Instant.now();
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
