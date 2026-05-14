package com.test.orders.infrastructure.adapters.catalog.dtos;

import com.test.orders.infrastructure.adapters.catalog.dtos.ProductPriceValidationItemDto;
import java.util.List;

/**
 * Infrastructure DTO — shape of the ProductPriceValidationResultDto response from catalog BC.
 * Only used inside the adapter layer; never exposed to application or domain layers.
 */
public record ProductPriceValidationResultDto(boolean valid, List<ProductPriceValidationItemDto> items) {}
