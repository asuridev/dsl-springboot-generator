package com.test.catalog.application.dtos;

import com.test.catalog.domain.enums.ProductStatus;
import com.test.catalog.domain.valueobject.Money;
import java.util.UUID;

public record ProductResponseDto(UUID id, String name, ProductStatus status, Money price) {}
