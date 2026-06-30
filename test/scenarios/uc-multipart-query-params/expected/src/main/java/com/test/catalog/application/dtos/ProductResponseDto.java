package com.test.catalog.application.dtos;

import java.util.List;
import java.util.UUID;

public record ProductResponseDto(UUID id, String name, List<ProductImageResponseDto> productImages) {}
