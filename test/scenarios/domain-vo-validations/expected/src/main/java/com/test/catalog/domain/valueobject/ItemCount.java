package com.test.catalog.domain.valueobject;

import java.util.Objects;

/**
 * ItemCount — Value Object
 * Immutable domain value object (pure Java, no Lombok).
 *
 * Covers Integer min/max and positive/negative validations.
 *
 * derived_from: valueObject:ItemCount
 */
public final class ItemCount {

    private final Integer stock;

    private final Integer reserved;

    public ItemCount(Integer stock, Integer reserved) {
        if (stock == null) {
            throw new IllegalArgumentException("VO ItemCount.stock: required");
        }
        if (stock != null && stock < 0) {
            throw new IllegalArgumentException("VO ItemCount.stock: must be >= 0");
        }
        if (reserved == null) {
            throw new IllegalArgumentException("VO ItemCount.reserved: required");
        }
        if (reserved != null && reserved < 0) {
            throw new IllegalArgumentException("VO ItemCount.reserved: must be >= 0");
        }
        if (reserved != null && reserved > 10000) {
            throw new IllegalArgumentException("VO ItemCount.reserved: must be <= 10000");
        }

        this.stock = stock;
        this.reserved = reserved;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public Integer getStock() {
        return stock;
    }

    public Integer getReserved() {
        return reserved;
    }

    // ─── Structural equality ──────────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        ItemCount that = (ItemCount) o;
        return Objects.equals(stock, that.stock) && Objects.equals(reserved, that.reserved);
    }

    @Override
    public int hashCode() {
        return Objects.hash(stock, reserved);
    }

    @Override
    public String toString() {
        return "ItemCount{" + "stock=" + stock + ", reserved=" + reserved + '}';
    }
}
