package com.test.billing.domain.valueobject;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Objects;

/**
 * Money — Value Object
 * Immutable domain value object (pure Java, no Lombok).
 *
 * derived_from: valueObject:Money
 */
public final class Money {

    private final BigDecimal amount;

    private final String currency;

    public Money(BigDecimal amount, String currency) {
        try {
            this.amount = (amount == null) ? null : amount.setScale(4, RoundingMode.UNNECESSARY);
        } catch (ArithmeticException ex) {
            throw new IllegalArgumentException("VO Money.amount: scale exceeds 4", ex);
        }
        this.currency = currency;
    }

    // ─── Getters ──────────────────────────────────────────────────────────────

    public BigDecimal getAmount() {
        return amount;
    }

    public String getCurrency() {
        return currency;
    }

    // ─── Structural equality ──────────────────────────────────────────────────

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Money that = (Money) o;
        return eqDecimal(amount, that.amount) && Objects.equals(currency, that.currency);
    }

    @Override
    public int hashCode() {
        return Objects.hash(amount, currency);
    }

    @Override
    public String toString() {
        return "Money{" + "amount=" + amount + ", currency=" + currency + '}';
    }

    private static boolean eqDecimal(java.math.BigDecimal a, java.math.BigDecimal b) {
        if (a == b) return true;
        if (a == null || b == null) return false;
        return a.compareTo(b) == 0;
    }
}
