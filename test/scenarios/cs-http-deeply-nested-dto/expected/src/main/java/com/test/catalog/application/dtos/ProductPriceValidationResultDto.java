package com.test.catalog.application.dtos;

import java.util.List;

public record ProductPriceValidationResultDto(boolean valid, List<ProductPriceValidationItemDto> items) {}
