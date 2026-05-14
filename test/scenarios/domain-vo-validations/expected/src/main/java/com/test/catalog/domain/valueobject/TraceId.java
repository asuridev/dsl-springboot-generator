package com.test.catalog.domain.valueobject;

import java.util.Objects;

/**
 * TraceId — Value Object
 * Immutable domain value object (pure Java, no Lombok).
 *
 * Covers Long with large min value (&gt; Integer.MAX_VALUE) — exercises L suffix fix.
 *
 * derived_from: valueObject:TraceId
 */
public final class TraceId {

    private final Long value;

    public TraceId(Long value) {
        if (value == null) {
            throw new IllegalArgumentException("VO TraceId.value: required");
        }
        if (value != null && value < 3000000000L) {
            throw new IllegalArgumentException("VO TraceId.value: must be >= 3000000000");
        }

        this.value = value;
    }

    /** Convenience factory. derived_from: valueObject:TraceId */
    public static TraceId of(Long value) {
        return new TraceId(value);
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public Long getValue() {
        return value;
    }

    // ─── Structural equality ──────────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        TraceId that = (TraceId) o;
        return Objects.equals(value, that.value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(value);
    }

    @Override
    public String toString() {
        return "TraceId{" + "value=" + value + '}';
    }
}
