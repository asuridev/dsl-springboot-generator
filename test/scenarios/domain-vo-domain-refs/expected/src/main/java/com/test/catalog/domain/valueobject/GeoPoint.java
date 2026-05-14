package com.test.catalog.domain.valueobject;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Objects;

/**
 * GeoPoint — Value Object
 * Immutable domain value object (pure Java, no Lombok).
 *
 * Geographic coordinate pair.
 *
 * derived_from: valueObject:GeoPoint
 */
public final class GeoPoint {

    private final BigDecimal latitude;

    private final BigDecimal longitude;

    public GeoPoint(BigDecimal latitude, BigDecimal longitude) {
        if (latitude == null) {
            throw new IllegalArgumentException("VO GeoPoint.latitude: required");
        }
        if (longitude == null) {
            throw new IllegalArgumentException("VO GeoPoint.longitude: required");
        }

        try {
            this.latitude = (latitude == null) ? null : latitude.setScale(6, RoundingMode.UNNECESSARY);
        } catch (ArithmeticException ex) {
            throw new IllegalArgumentException("VO GeoPoint.latitude: scale exceeds 6", ex);
        }
        try {
            this.longitude = (longitude == null) ? null : longitude.setScale(6, RoundingMode.UNNECESSARY);
        } catch (ArithmeticException ex) {
            throw new IllegalArgumentException("VO GeoPoint.longitude: scale exceeds 6", ex);
        }
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public BigDecimal getLatitude() {
        return latitude;
    }

    public BigDecimal getLongitude() {
        return longitude;
    }

    // ─── Structural equality ──────────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        GeoPoint that = (GeoPoint) o;
        return eqDecimal(latitude, that.latitude) && eqDecimal(longitude, that.longitude);
    }

    @Override
    public int hashCode() {
        return Objects.hash(latitude, longitude);
    }

    @Override
    public String toString() {
        return "GeoPoint{" + "latitude=" + latitude + ", longitude=" + longitude + '}';
    }

    private static boolean eqDecimal(java.math.BigDecimal a, java.math.BigDecimal b) {
        if (a == b) return true;
        if (a == null || b == null) return false;
        return a.compareTo(b) == 0;
    }
}
