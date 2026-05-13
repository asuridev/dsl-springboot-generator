package com.test.ordering.domain.aggregate;

import com.test.ordering.domain.entity.OrderLine;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Order — Aggregate Root
 * Pure domain class (no Lombok, no public setters).
 */
public class Order {

    // ─── Fields ───────────────────────────────────────────────────────────────
    private final UUID id;
    private UUID customerId;

    private List<OrderLine> orderLines = new ArrayList<>();

    private Instant createdAt;
    private Instant updatedAt;

    // ─── Full constructor (reconstruction from persistence) ───────────────────
    public Order(UUID id, UUID customerId, List<OrderLine> orderLines, Instant createdAt, Instant updatedAt) {
        this.id = id;
        this.customerId = customerId;

        this.orderLines = new ArrayList<>(orderLines != null ? orderLines : java.util.Collections.emptyList());

        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    // ─── Creation constructor (new Order) ───────────────────────────────
    private Order(UUID customerId) {
        this.id = UUID.randomUUID();
        this.customerId = customerId;
    }

    // ─── Static factory ───────────────────────────────────────────────────────

    /** derived_from: UC-ORD-001 CreateOrder */
    public static Order create(UUID customerId) {
        Order instance = new Order(customerId);
        return instance;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getId() {
        return id;
    }

    public UUID getCustomerId() {
        return customerId;
    }

    public List<OrderLine> getOrderLines() {
        return java.util.Collections.unmodifiableList(orderLines);
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    // ─── Business methods ─────────────────────────────────────────────────────

    /** derived_from: UC-ORD-002 AddOrderLine */
    public void addOrderLine(UUID productId, Integer quantity, List<String> tags) {
        this.orderLines.add(new OrderLine(productId, quantity, tags));
    }

    /** derived_from: UC-ORD-003 RemoveOrderLine */
    public void removeOrderLine(UUID lineId) {
        this.orderLines.removeIf(orderLine -> orderLine.getId().equals(lineId));
    }

    // ─── Identity equality (S20) ──────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Order that = (Order) o;
        return java.util.Objects.equals(this.id, that.id);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(this.id);
    }

    @Override
    public String toString() {
        return "Order{id=" + this.id + "}";
    }
}
