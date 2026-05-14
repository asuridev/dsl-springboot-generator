package com.test.catalog.domain.valueobject;

import java.util.Objects;

/**
 * ProductCode — Value Object
 * Immutable domain value object (pure Java, no Lombok).
 *
 * Covers String notEmpty and minLength validations.
 *
 * derived_from: valueObject:ProductCode
 */
public final class ProductCode {

    private final String value;

    public ProductCode(String value) {
        if (value == null) {
            throw new IllegalArgumentException("VO ProductCode.value: required");
        }
        if (value != null && value.length() > 50) {
            throw new IllegalArgumentException("VO ProductCode.value: exceeds max length 50");
        }
        if (value != null && value.length() < 3) {
            throw new IllegalArgumentException("VO ProductCode.value: below min length 3");
        }
        if (value != null && value.isEmpty()) {
            throw new IllegalArgumentException("VO ProductCode.value: must not be empty");
        }

        this.value = value;
    }

    /** Convenience factory. derived_from: valueObject:ProductCode */
    public static ProductCode of(String value) {
        return new ProductCode(value);
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public String getValue() {
        return value;
    }

    // ─── Structural equality ──────────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        ProductCode that = (ProductCode) o;
        return Objects.equals(value, that.value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(value);
    }

    @Override
    public String toString() {
        return "ProductCode{" + "value=" + value + '}';
    }
}
