package com.test.orders.infrastructure.adapters.catalog.dtos;

/**
 * Infrastructure DTO — shape of the ProductDetailsDto response from catalog BC.
 * Only used inside the adapter layer; never exposed to application or domain layers.
 */
public record ProductDetailsDto(String productId, String name, java.math.BigDecimal price) {}
