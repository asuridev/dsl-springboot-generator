package com.test.catalog.application.dtos;

import java.time.Instant;
import java.util.UUID;

public record TagResponseDto(UUID id, Instant createdAt, Instant updatedAt) {}
