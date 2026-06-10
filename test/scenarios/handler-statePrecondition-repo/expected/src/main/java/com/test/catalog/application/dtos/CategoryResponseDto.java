package com.test.catalog.application.dtos;

import com.test.catalog.domain.enums.CategoryStatus;
import java.util.UUID;

public record CategoryResponseDto(UUID id, String name, CategoryStatus status) {}
