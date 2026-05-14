package com.test.orders.infrastructure.adapters.catalog.dtos;

import java.util.List;

/**
 * Infrastructure DTO — shape of the ProductPriceValidationRequestDto response from catalog BC.
 * Only used inside the adapter layer; never exposed to application or domain layers.
 */
public record ProductPriceValidationRequestDto(List<String> productIds) {}
