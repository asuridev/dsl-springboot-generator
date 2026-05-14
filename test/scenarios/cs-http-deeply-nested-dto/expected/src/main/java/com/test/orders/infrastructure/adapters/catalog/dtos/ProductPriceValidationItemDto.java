package com.test.orders.infrastructure.adapters.catalog.dtos;

import com.test.orders.infrastructure.adapters.catalog.dtos.MoneyDto;

/**
 * Infrastructure DTO — shape of the ProductPriceValidationItemDto response from catalog BC.
 * Only used inside the adapter layer; never exposed to application or domain layers.
 */
public record ProductPriceValidationItemDto(String productId, boolean available, MoneyDto unitPrice) {}
