package com.test.orders.infrastructure.adapters.catalog.dtos;

/**
 * Infrastructure DTO — shape of the ValidateProductsRequestDto response from catalog BC.
 * Only used inside the adapter layer; never exposed to application or domain layers.
 */
public record ValidateProductsRequestDto(String productId, int quantity) {}
