package com.test.catalog.application.dtos;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record ProductResponseDto(
    UUID id,
    String name,
    BigDecimal price,
    Integer stock,
    Instant createdAt,
    Instant updatedAt
) {}
