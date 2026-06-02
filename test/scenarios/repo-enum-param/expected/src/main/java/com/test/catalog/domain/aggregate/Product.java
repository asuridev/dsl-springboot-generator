package com.test.catalog.domain.aggregate;

import com.test.catalog.domain.enums.Category;
import java.util.UUID;

/**
 * Product — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Product {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String name;
    private Category category;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Product(UUID id, String name, Category category) {
        this.id = id;
        this.name = name;
        this.category = category;
    }

    // ─── Creation constructor (new Product) ───────────────────────────────
    private Product(String name, Category category) {
        this.id = UUID.randomUUID();
        this.name = name;
        this.category = category;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public Category getCategory() {
        return category;
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
