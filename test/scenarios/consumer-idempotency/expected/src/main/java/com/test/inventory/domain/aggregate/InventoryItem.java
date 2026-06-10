package com.test.inventory.domain.aggregate;

import java.util.UUID;

/**
 * InventoryItem — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class InventoryItem {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private UUID productId;
    private Integer stock;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public InventoryItem(UUID id, UUID productId, Integer stock) {
        this.id = id;
        this.productId = productId;
        this.stock = stock;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public UUID getProductId() {
        return productId;
    }

    public Integer getStock() {
        return stock;
    }

    // ─── Business methods ─────────────────────────────────────────────────────

    /** derived_from: register-product-in-catalog RegisterProductInCatalog */
    public void register(UUID productId) {
        this.productId = productId;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        InventoryItem that = (InventoryItem) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "InventoryItem{id=" + this.id + "}";
    }
}
