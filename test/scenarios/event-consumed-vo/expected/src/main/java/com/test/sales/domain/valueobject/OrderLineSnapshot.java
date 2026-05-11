package com.test.sales.domain.valueobject;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Objects;
import java.util.UUID;

/**
 * OrderLineSnapshot — Value Object
 * Immutable domain value object (pure Java, no Lombok).
 *
 * derived_from: valueObject:OrderLineSnapshot
 */
public final class OrderLineSnapshot {

    private final UUID productId;

    private final Integer quantity;

    private final BigDecimal unitPrice;

    public OrderLineSnapshot(UUID productId, Integer quantity, BigDecimal unitPrice) {
        this.productId = productId;
        this.quantity = quantity;
        try {
            this.unitPrice = (unitPrice == null) ? null : unitPrice.setScale(2, RoundingMode.UNNECESSARY);
        } catch (ArithmeticException ex) {
            throw new IllegalArgumentException("VO OrderLineSnapshot.unitPrice: scale exceeds 2", ex);
        }
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public UUID getProductId() {
        return productId;
    }

    public Integer getQuantity() {
        return quantity;
    }

    public BigDecimal getUnitPrice() {
        return unitPrice;
    }

    // ─── Structural equality ──────────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        OrderLineSnapshot that = (OrderLineSnapshot) o;
        return (
            Objects.equals(productId, that.productId) &&
            Objects.equals(quantity, that.quantity) &&
            eqDecimal(unitPrice, that.unitPrice)
        );
    }

    @Override
    public int hashCode() {
        return Objects.hash(productId, quantity, unitPrice);
    }

    @Override
    public String toString() {
        return (
            "OrderLineSnapshot{" +
            "productId=" +
            productId +
            ", quantity=" +
            quantity +
            ", unitPrice=" +
            unitPrice +
            '}'
        );
    }

    private static boolean eqDecimal(java.math.BigDecimal a, java.math.BigDecimal b) {
        if (a == b) return true;
        if (a == null || b == null) return false;
        return a.compareTo(b) == 0;
    }
}
