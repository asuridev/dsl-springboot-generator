package com.test.catalog.domain.valueobject;

import java.time.Duration;
import java.util.Objects;

/**
 * Dimensions — Value Object
 * Immutable domain value object (pure Java, no Lombok).
 *
 * Covers Long and Duration canonical types.
 *
 * derived_from: valueObject:Dimensions
 */
public final class Dimensions {

    private final Long weightGrams;

    private final Duration processingTime;

    public Dimensions(Long weightGrams, Duration processingTime) {
        if (weightGrams == null) {
            throw new IllegalArgumentException("VO Dimensions.weightGrams: required");
        }

        this.weightGrams = weightGrams;
        this.processingTime = processingTime;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public Long getWeightGrams() {
        return weightGrams;
    }

    public Duration getProcessingTime() {
        return processingTime;
    }

    // ─── Structural equality ──────────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Dimensions that = (Dimensions) o;
        return Objects.equals(weightGrams, that.weightGrams) && Objects.equals(processingTime, that.processingTime);
    }

    @Override
    public int hashCode() {
        return Objects.hash(weightGrams, processingTime);
    }

    @Override
    public String toString() {
        return "Dimensions{" + "weightGrams=" + weightGrams + ", processingTime=" + processingTime + '}';
    }
}
