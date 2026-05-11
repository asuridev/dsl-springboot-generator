package com.test.catalog.application.dtos;

import java.time.Instant;
import java.util.UUID;

public record ItemResponseDto(UUID id, String name, String status, Instant createdAt, Instant updatedAt) {}
