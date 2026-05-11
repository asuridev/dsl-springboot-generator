package com.test.catalog.domain.valueobject;

import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Slug — Value Object
 * Immutable domain value object (pure Java, no Lombok).
 *
 * URL-friendly identifier derived from product name.
 *
 * derived_from: valueObject:Slug
 */
public final class Slug {

    private final String value;

    public Slug(String value) {
        if (value == null) {
            throw new IllegalArgumentException("VO Slug.value: required");
        }
        if (value != null && value.length() > 200) {
            throw new IllegalArgumentException("VO Slug.value: exceeds max length 200");
        }
        if (value != null && !Pattern.matches("^[a-z0-9]+(?:-[a-z0-9]+)*$", value)) {
            throw new IllegalArgumentException("VO Slug.value: does not match required pattern");
        }

        this.value = value;
    }

    /** Convenience factory. derived_from: valueObject:Slug */
    public static Slug of(String value) {
        return new Slug(value);
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
        Slug that = (Slug) o;
        return Objects.equals(value, that.value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(value);
    }

    @Override
    public String toString() {
        return "Slug{" + "value=" + value + '}';
    }
}
