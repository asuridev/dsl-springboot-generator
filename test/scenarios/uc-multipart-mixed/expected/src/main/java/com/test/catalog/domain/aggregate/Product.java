package com.test.catalog.domain.aggregate;

import com.test.catalog.domain.entity.ProductImage;
import com.test.shared.domain.valueobject.StoredObject;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Product — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Product {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String name;

    private List<ProductImage> productImages = new ArrayList<>();

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Product(UUID id, String name, List<ProductImage> productImages) {
        this.id = id;
        this.name = name;

        this.productImages = new ArrayList<>(productImages != null ? productImages : java.util.Collections.emptyList());
    }

    // ─── Creation constructor (new Product) ───────────────────────────────
    // Identity is assigned at the application edge (controller) and propagated
    // here via the command/factory — not generated inside the domain.
    private Product(UUID id, String name) {
        this.id = id;
        this.name = name;
    }

    // ─── Static factory ───────────────────────────────────────────────────────

    /** derived_from: UC-CAT-001 CreateProduct */
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

    public List<ProductImage> getProductImages() {
        return java.util.Collections.unmodifiableList(productImages);
    }

    // ─── Business methods ─────────────────────────────────────────────────────

    /** derived_from: UC-CAT-011 AddProductImage */
    public void addImage(StoredObject media) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }

    /** derived_from: UC-CAT-012 RemoveProductImage */
    public void removeImage(UUID imageId) {
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
