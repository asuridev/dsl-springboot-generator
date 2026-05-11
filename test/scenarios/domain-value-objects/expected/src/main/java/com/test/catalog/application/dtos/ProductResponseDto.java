package com.test.catalog.application.dtos;

import com.test.catalog.domain.valueobject.Money;
import java.util.UUID;

public record ProductResponseDto(UUID id, String name, Money price, String slug) {}
