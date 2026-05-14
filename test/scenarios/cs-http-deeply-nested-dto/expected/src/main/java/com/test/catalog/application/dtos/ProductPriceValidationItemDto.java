package com.test.catalog.application.dtos;

import java.util.UUID;

public record ProductPriceValidationItemDto(UUID productId, boolean available, MoneyDto unitPrice) {}
