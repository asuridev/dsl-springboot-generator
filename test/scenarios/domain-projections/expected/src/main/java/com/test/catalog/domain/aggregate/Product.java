package com.test.catalog.domain.aggregate;

import com.test.catalog.domain.enums.ProductStatus;
import com.test.catalog.domain.valueobject.Money;
import java.util.UUID;

/**
 * Product — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Product {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String name;
    private ProductStatus status;
    private Money price;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Product(UUID id, String name, ProductStatus status, Money price) {
        this.id = id;
        this.name = name;
        this.status = status;
        this.price = price;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public ProductStatus getStatus() {
        return status;
    }

    public Money getPrice() {
        return price;
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
