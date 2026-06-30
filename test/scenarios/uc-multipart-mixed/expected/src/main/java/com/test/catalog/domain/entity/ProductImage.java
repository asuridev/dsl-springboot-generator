package com.test.catalog.domain.entity;

import com.test.shared.domain.valueobject.StoredObject;
import java.util.UUID;

/**
 * ProductImage — Domain Entity (composition)
 * Owned by and loaded with its aggregate root. No independent repository.
 */
public class ProductImage {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private StoredObject media;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public ProductImage(UUID id, StoredObject media) {
        this.id = id;
        this.media = media;
    }

    // ─── Creation constructor (new ProductImage) ──────────────────────────────────
    public ProductImage(StoredObject media) {
        this.id = UUID.randomUUID();
        this.media = media;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public StoredObject getMedia() {
        return media;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        ProductImage that = (ProductImage) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "ProductImage{id=" + this.id + "}";
    }
}
