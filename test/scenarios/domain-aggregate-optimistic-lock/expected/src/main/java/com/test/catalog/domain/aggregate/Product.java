package com.test.catalog.domain.aggregate;

import com.test.catalog.domain.enums.ProductStatus;
import com.test.catalog.domain.errors.ProductAlreadyDiscontinuedError;
import com.test.shared.domain.customExceptions.InvalidStateTransitionException;
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

    private Long version;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Product(UUID id, String name, ProductStatus status, Long version) {
        this.id = id;
        this.name = name;
        this.status = status;

        this.version = version;
    }

    // ─── Creation constructor (new Product) ───────────────────────────────
    // Identity is assigned at the application edge (controller) and propagated
    // here via the command/factory — not generated inside the domain.
    private Product(UUID id, String name) {
        this.id = id;
        this.name = name;

        this.status = ProductStatus.DRAFT;
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

    public Long getVersion() {
        return version;
    }

    // ─── Business methods ─────────────────────────────────────────────────────

    /** derived_from: UC-PRD-001 ActivateProduct */
    public void activate() {
        // derived_from: UC-PRD-001 ActivateProduct
        try {
            this.status = this.status.transitionTo(ProductStatus.ACTIVE);
        } catch (InvalidStateTransitionException ex) {
            throw new ProductAlreadyDiscontinuedError();
        }
    }

    /** derived_from: UC-PRD-002 DiscontinueProduct */
    public void discontinue() {
        // derived_from: UC-PRD-002 DiscontinueProduct
        try {
            this.status = this.status.transitionTo(ProductStatus.DISCONTINUED);
        } catch (InvalidStateTransitionException ex) {
            throw new ProductAlreadyDiscontinuedError();
        }
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
