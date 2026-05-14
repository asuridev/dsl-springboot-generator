package com.test.catalog.domain.valueobject;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * IdBundle — Value Object
 * Immutable domain value object (pure Java, no Lombok).
 *
 * Covers List[Uuid] property.
 *
 * derived_from: valueObject:IdBundle
 */
public final class IdBundle {

    private final List<UUID> itemIds;

    public IdBundle(List<UUID> itemIds) {
        if (itemIds == null) {
            throw new IllegalArgumentException("VO IdBundle.itemIds: required");
        }

        this.itemIds = (itemIds == null) ? List.of() : List.copyOf(itemIds);
    }

    /** Convenience factory. derived_from: valueObject:IdBundle */
    public static IdBundle of(List<UUID> itemIds) {
        return new IdBundle(itemIds);
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public List<UUID> getItemIds() {
        return itemIds;
    }

    // ─── Structural equality ──────────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        IdBundle that = (IdBundle) o;
        return Objects.equals(itemIds, that.itemIds);
    }

    @Override
    public int hashCode() {
        return Objects.hash(itemIds);
    }

    @Override
    public String toString() {
        return "IdBundle{" + "itemIds=" + itemIds + '}';
    }
}
