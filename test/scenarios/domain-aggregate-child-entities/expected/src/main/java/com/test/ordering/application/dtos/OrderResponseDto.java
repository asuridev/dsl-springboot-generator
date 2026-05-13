package com.test.ordering.application.dtos;

import java.time.Instant;
import java.util.UUID;

public record OrderResponseDto(UUID id, UUID customerId, Instant createdAt, Instant updatedAt) {}
