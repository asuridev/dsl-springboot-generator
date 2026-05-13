package com.test.ordering.domain.entity;

import java.util.List;
import java.util.UUID;

/**
 * OrderLine — Domain Entity (composition)
 * Owned by and loaded with its aggregate root. No independent repository.
 */
public class OrderLine {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private UUID productId;
    private Integer quantity;
    private List<String> tags;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public OrderLine(UUID id, UUID productId, Integer quantity, List<String> tags) {
        this.id = id;
        this.productId = productId;
        this.quantity = quantity;
        this.tags = tags;
    }

    // ─── Creation constructor (new OrderLine) ──────────────────────────────────
    public OrderLine(UUID productId, Integer quantity, List<String> tags) {
        this.id = UUID.randomUUID();
        this.productId = productId;
        this.quantity = quantity;
        this.tags = tags;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public UUID getProductId() {
        return productId;
    }

    public Integer getQuantity() {
        return quantity;
    }

    public List<String> getTags() {
        return tags;
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        OrderLine that = (OrderLine) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "OrderLine{id=" + this.id + "}";
    }
}
