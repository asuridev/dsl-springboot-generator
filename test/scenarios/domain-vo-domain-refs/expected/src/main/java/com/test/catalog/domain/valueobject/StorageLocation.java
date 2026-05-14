package com.test.catalog.domain.valueobject;

import com.test.catalog.domain.enums.ItemStatus;
import java.util.Objects;
import java.util.UUID;

/**
 * StorageLocation — Value Object
 * Immutable domain value object (pure Java, no Lombok).
 *
 * Covers nested VO reference (GeoPoint) and bare enum type (ItemStatus).
 *
 * derived_from: valueObject:StorageLocation
 */
public final class StorageLocation {

    private final UUID warehouseId;

    private final GeoPoint coordinates;

    private final ItemStatus status;

    public StorageLocation(UUID warehouseId, GeoPoint coordinates, ItemStatus status) {
        if (warehouseId == null) {
            throw new IllegalArgumentException("VO StorageLocation.warehouseId: required");
        }
        if (coordinates == null) {
            throw new IllegalArgumentException("VO StorageLocation.coordinates: required");
        }
        if (status == null) {
            throw new IllegalArgumentException("VO StorageLocation.status: required");
        }

        this.warehouseId = warehouseId;
        this.coordinates = coordinates;
        this.status = status;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getWarehouseId() {
        return warehouseId;
    }

    public GeoPoint getCoordinates() {
        return coordinates;
    }

    public ItemStatus getStatus() {
        return status;
    }

    // ─── Structural equality ──────────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        StorageLocation that = (StorageLocation) o;
        return (
            Objects.equals(warehouseId, that.warehouseId) &&
            Objects.equals(coordinates, that.coordinates) &&
            Objects.equals(status, that.status)
        );
    }

    @Override
    public int hashCode() {
        return Objects.hash(warehouseId, coordinates, status);
    }

    @Override
    public String toString() {
        return (
            "StorageLocation{" +
            "warehouseId=" +
            warehouseId +
            ", coordinates=" +
            coordinates +
            ", status=" +
            status +
            '}'
        );
    }
}
