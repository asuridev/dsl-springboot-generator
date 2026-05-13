package com.test.warehouse.domain.aggregate;

import java.util.UUID;

/**
 * Stock — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Stock {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String sku;
    private Integer quantity;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Stock(UUID id, String sku, Integer quantity) {
        this.id = id;
        this.sku = sku;
        this.quantity = quantity;
    }

    // ─── Creation constructor (new Stock) ───────────────────────────────
    private Stock(String sku, Integer quantity) {
        this.id = UUID.randomUUID();
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
        Stock that = (Stock) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Stock{id=" + this.id + "}";
    }
}
