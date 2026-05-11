package com.test.catalog.domain.aggregate;

import com.test.catalog.domain.valueobject.Money;
import com.test.catalog.domain.valueobject.Slug;
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
    private Slug slug;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Product(UUID id, String name, Money price, Slug slug) {
        this.id = id;
        this.name = name;
        this.price = price;
        this.slug = slug;
    }

    // ─── Creation constructor (new Product) ───────────────────────────────
    private Product(String name, Money price, Slug slug) {
        this.id = UUID.randomUUID();
        this.name = name;
        this.price = price;
        this.slug = slug;
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

    public Slug getSlug() {
        return slug;
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
