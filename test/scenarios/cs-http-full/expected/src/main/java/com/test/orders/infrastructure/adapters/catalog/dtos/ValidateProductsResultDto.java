package com.test.orders.infrastructure.adapters.catalog.dtos;

/**
 * Infrastructure DTO — shape of the ValidateProductsResultDto response from catalog BC.
 * Only used inside the adapter layer; never exposed to application or domain layers.
 */
public record ValidateProductsResultDto(boolean valid, java.math.BigDecimal unitPrice) {}
