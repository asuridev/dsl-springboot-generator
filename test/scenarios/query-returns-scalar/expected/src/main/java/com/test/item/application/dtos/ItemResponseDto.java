package com.test.item.application.dtos;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record ItemResponseDto(UUID id, String name, BigDecimal price, Instant createdAt) {}
