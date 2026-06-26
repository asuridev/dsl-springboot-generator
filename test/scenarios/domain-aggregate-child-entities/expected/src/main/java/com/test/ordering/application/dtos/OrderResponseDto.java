package com.test.ordering.application.dtos;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record OrderResponseDto(
    UUID id,
    UUID customerId,
    List<OrderLineResponseDto> orderLines,
    Instant createdAt,
    Instant updatedAt
) {}
