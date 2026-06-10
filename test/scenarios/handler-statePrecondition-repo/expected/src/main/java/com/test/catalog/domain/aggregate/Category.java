package com.test.catalog.domain.aggregate;

import com.test.catalog.domain.enums.CategoryStatus;
import java.util.UUID;

/**
 * Category — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Category {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private String name;
    private CategoryStatus status;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Category(UUID id, String name, CategoryStatus status) {
        this.id = id;
        this.name = name;
        this.status = status;
    }

    // ─── Creation constructor (new Category) ───────────────────────────────
    // Identity is assigned at the application edge (controller) and propagated
    // here via the command/factory — not generated inside the domain.
    private Category(UUID id, String name) {
        this.id = id;
        this.name = name;

        this.status = CategoryStatus.ACTIVE;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public CategoryStatus getStatus() {
        return status;
    }

    // ─── Business methods ─────────────────────────────────────────────────────

    /** derived_from: UC-CAT-010 ArchiveCategory */
    public void archive() {
        // TODO: implement business logic — ver catalog-flows.md
        // Validate: CAT-RULE-001
        throw new UnsupportedOperationException("Not implemented yet");
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Category that = (Category) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Category{id=" + this.id + "}";
    }
}
