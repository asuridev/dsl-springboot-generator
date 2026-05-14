package com.test.catalog.domain.valueobject;

import com.test.catalog.domain.enums.ItemStatus;
import java.util.List;
import java.util.Objects;

/**
 * TagSet — Value Object
 * Immutable domain value object (pure Java, no Lombok).
 *
 * Covers List[Enum&lt;X&gt;] and List[VO] properties.
 *
 * derived_from: valueObject:TagSet
 */
public final class TagSet {

    private final List<ItemStatus> statuses;

    private final List<GeoPoint> locations;

    public TagSet(List<ItemStatus> statuses, List<GeoPoint> locations) {
        this.statuses = (statuses == null) ? List.of() : List.copyOf(statuses);
        this.locations = (locations == null) ? List.of() : List.copyOf(locations);
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public List<ItemStatus> getStatuses() {
        return statuses;
    }

    public List<GeoPoint> getLocations() {
        return locations;
    }

    // ─── Structural equality ──────────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        TagSet that = (TagSet) o;
        return Objects.equals(statuses, that.statuses) && Objects.equals(locations, that.locations);
    }

    @Override
    public int hashCode() {
        return Objects.hash(statuses, locations);
    }

    @Override
    public String toString() {
        return "TagSet{" + "statuses=" + statuses + ", locations=" + locations + '}';
    }
}
