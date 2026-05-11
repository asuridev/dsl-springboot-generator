package com.test.catalog.application.dtos;

import java.time.Instant;
import java.util.UUID;

public record ProductResponseDto(
    UUID id,
    String name,
    UUID categoryId,
    String status,
    Instant createdAt,
    Instant updatedAt
) {}
