package com.test.catalog.application.dtos;

import java.time.Instant;
import java.util.UUID;

public record CategoryResponseDto(UUID id, String name, UUID parentId, Instant createdAt, Instant updatedAt) {}
