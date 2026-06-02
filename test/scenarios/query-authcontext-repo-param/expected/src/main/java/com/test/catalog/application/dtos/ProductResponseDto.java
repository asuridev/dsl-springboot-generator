package com.test.catalog.application.dtos;

import com.test.catalog.domain.enums.ProductStatus;
import java.util.UUID;

public record ProductResponseDto(UUID id, UUID ownerId, String name, ProductStatus status) {}
