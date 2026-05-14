package com.test.inventory.infrastructure.adapters.catalog.dtos;

/**
 * Infrastructure DTO — shape of the AvailableProductDto response from catalog BC.
 * Only used inside the adapter layer; never exposed to application or domain layers.
 */
public record AvailableProductDto(String productId, String name, java.math.BigDecimal unitPrice) {}
