package com.test.catalog.application.dtos;

import java.time.Instant;
import java.util.UUID;

public record ProductResponseDto(
    UUID id,
    String name,
    String description,
    String sku,
    Instant createdAt,
    Instant updatedAt
) {}
