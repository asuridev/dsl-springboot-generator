package com.test.catalog.domain.aggregate;

import com.test.catalog.domain.valueobject.Money;
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
    private Money price;

    private Instant createdAt;
    private Instant updatedAt;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Product(UUID id, String name, Money price, Instant createdAt, Instant updatedAt) {
        this.id = id;
        this.name = name;
        this.price = price;

        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    // ─── Creation constructor (new Product) ───────────────────────────────
    // Identity is assigned at the application edge (controller) and propagated
    // here via the command/factory — not generated inside the domain.
    private Product(UUID id, String name, Money price) {
        this.id = id;
        this.name = name;
        this.price = price;
    }

    // ─── Static factory ───────────────────────────────────────────────────────

    /** derived_from: UC-CAT-001 CreateProduct */
    public static Product create(UUID id, String name, Money price) {
        Product instance = new Product(id, name, price);
        return instance;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public Money getPrice() {
        return price;
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
