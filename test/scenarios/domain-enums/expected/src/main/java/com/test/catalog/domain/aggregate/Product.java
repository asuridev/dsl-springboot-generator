package com.test.catalog.domain.aggregate;

import com.test.catalog.domain.enums.ProductStatus;
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

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Product(UUID id, String name, ProductStatus status) {
        this.id = id;
        this.name = name;
        this.status = status;
    }

    // ─── Creation constructor (new Product) ───────────────────────────────
    private Product(String name, ProductStatus status) {
        this.id = UUID.randomUUID();
        this.name = name;
        this.status = status;
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

    // ─── Business methods ─────────────────────────────────────────────────────

    /** derived_from: UC-PRD-001 ActivateProduct */
    public void activate() {
        // derived_from: UC-PRD-001 ActivateProduct
        this.status = this.status.transitionTo(ProductStatus.ACTIVE);
    }

    /** derived_from: UC-PRD-002 DiscontinueProduct */
    public void discontinue() {
        // derived_from: UC-PRD-002 DiscontinueProduct
        this.status = this.status.transitionTo(ProductStatus.DISCONTINUED);
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
