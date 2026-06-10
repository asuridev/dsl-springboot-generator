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
    private UUID ownerId;
    private String name;
    private ProductStatus status;
    private String secretNote;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Product(UUID id, UUID ownerId, String name, ProductStatus status, String secretNote) {
        this.id = id;
        this.ownerId = ownerId;
        this.name = name;
        this.status = status;
        this.secretNote = secretNote;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public UUID getOwnerId() {
        return ownerId;
    }

    public String getName() {
        return name;
    }

    public ProductStatus getStatus() {
        return status;
    }

    public String getSecretNote() {
        return secretNote;
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
