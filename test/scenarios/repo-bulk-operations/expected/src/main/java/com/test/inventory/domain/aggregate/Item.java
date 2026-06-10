package com.test.inventory.domain.aggregate;

import java.util.UUID;

/**
 * Item — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Item {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String sku;
    private Integer quantity;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Item(UUID id, String sku, Integer quantity) {
        this.id = id;
        this.sku = sku;
        this.quantity = quantity;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public String getSku() {
        return sku;
    }

    public Integer getQuantity() {
        return quantity;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Item that = (Item) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Item{id=" + this.id + "}";
    }
}
