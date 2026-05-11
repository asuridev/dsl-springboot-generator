package com.test.catalog.domain.aggregate;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Product — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Product {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String name;
    private BigDecimal price;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Product(UUID id, String name, BigDecimal price) {
        this.id = id;
        this.name = name;
        this.price = price;
    }

    // ─── Creation constructor (new Product) ───────────────────────────────
    private Product(String name, BigDecimal price) {
        this.id = UUID.randomUUID();
        this.name = name;
        this.price = price;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public BigDecimal getPrice() {
        return price;
    }

    // ─── Business methods ─────────────────────────────────────────────────────

    /** derived_from: validate-products-and-prices ValidateProductsAndPrices */
    public void validate(UUID productId) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
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
