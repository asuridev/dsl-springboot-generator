package com.test.catalog.domain.valueobject;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Objects;

/**
 * PriceRange — Value Object
 * Immutable domain value object (pure Java, no Lombok).
 *
 * Covers multiple Decimal fields with min/max validations and multiple eqDecimal() calls.
 *
 * derived_from: valueObject:PriceRange
 */
public final class PriceRange {

    private final BigDecimal minPrice;

    private final BigDecimal maxPrice;

    public PriceRange(BigDecimal minPrice, BigDecimal maxPrice) {
        if (minPrice == null) {
            throw new IllegalArgumentException("VO PriceRange.minPrice: required");
        }
        if (minPrice != null && minPrice.compareTo(new BigDecimal("0")) < 0) {
            throw new IllegalArgumentException("VO PriceRange.minPrice: must be >= 0");
        }
        if (maxPrice == null) {
            throw new IllegalArgumentException("VO PriceRange.maxPrice: required");
        }
        if (maxPrice != null && maxPrice.compareTo(new BigDecimal("0")) <= 0) {
            throw new IllegalArgumentException("VO PriceRange.maxPrice: must be > 0");
        }

        try {
            this.minPrice = (minPrice == null) ? null : minPrice.setScale(2, RoundingMode.UNNECESSARY);
        } catch (ArithmeticException ex) {
            throw new IllegalArgumentException("VO PriceRange.minPrice: scale exceeds 2", ex);
        }
        try {
            this.maxPrice = (maxPrice == null) ? null : maxPrice.setScale(2, RoundingMode.UNNECESSARY);
        } catch (ArithmeticException ex) {
            throw new IllegalArgumentException("VO PriceRange.maxPrice: scale exceeds 2", ex);
        }
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public BigDecimal getMinPrice() {
        return minPrice;
    }

    public BigDecimal getMaxPrice() {
        return maxPrice;
    }

    // ─── Structural equality ──────────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        PriceRange that = (PriceRange) o;
        return eqDecimal(minPrice, that.minPrice) && eqDecimal(maxPrice, that.maxPrice);
    }

    @Override
    public int hashCode() {
        return Objects.hash(minPrice, maxPrice);
    }

    @Override
    public String toString() {
        return "PriceRange{" + "minPrice=" + minPrice + ", maxPrice=" + maxPrice + '}';
    }

    private static boolean eqDecimal(java.math.BigDecimal a, java.math.BigDecimal b) {
        if (a == b) return true;
        if (a == null || b == null) return false;
        return a.compareTo(b) == 0;
    }
}
