package com.test.catalog.application.dtos;

import java.math.BigDecimal;
import java.util.UUID;

public record AvailableProductDto(UUID productId, String name, BigDecimal unitPrice) {}
