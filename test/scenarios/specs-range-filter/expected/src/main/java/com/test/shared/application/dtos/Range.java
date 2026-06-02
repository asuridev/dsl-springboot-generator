package com.test.shared.application.dtos;

/**
 * Generic range filter (G8).
 *
 * Carried in query records and DTOs whenever a use case input declares
 * type {@code Range[T]}. Both bounds are optional — callers may pass only
 * {@code min}, only {@code max}, or both. The repository Specification
 * builders translate non-null bounds into {@code &gt;=} / {@code &lt;=}
 * predicates (inclusive on both sides).
 *
 * @param <T> the bound type (typically {@link java.math.BigDecimal},
 *            {@link java.time.Instant}, {@link Integer}, {@link Long}, …)
 * @param min inclusive lower bound — {@code null} means "no lower bound"
 * @param max inclusive upper bound — {@code null} means "no upper bound"
 */
public record Range<T>(T min, T max) {}
