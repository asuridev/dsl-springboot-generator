package com.test.item.domain.aggregate;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Item — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Item {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String name;
    private BigDecimal price;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Item(UUID id, String name, BigDecimal price) {
        this.id = id;
        this.name = name;
        this.price = price;
    }

    // ─── Creation constructor (new Item) ───────────────────────────────
    private Item(String name, BigDecimal price) {
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
