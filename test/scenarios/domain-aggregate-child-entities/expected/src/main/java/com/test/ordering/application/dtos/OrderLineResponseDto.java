package com.test.ordering.application.dtos;

import java.util.List;
import java.util.UUID;

public record OrderLineResponseDto(UUID id, UUID productId, Integer quantity, List<String> tags) {}
