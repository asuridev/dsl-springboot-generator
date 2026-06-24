package com.test.catalog.application.dtos;

import com.test.catalog.domain.valueobject.Money;
import java.time.Instant;
import java.util.UUID;

public record ProductResponseDto(UUID id, String name, Money price, Instant createdAt, Instant updatedAt) {}
