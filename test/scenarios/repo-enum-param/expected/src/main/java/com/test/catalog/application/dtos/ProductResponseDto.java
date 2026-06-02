package com.test.catalog.application.dtos;

import com.test.catalog.domain.enums.Category;
import java.util.UUID;

public record ProductResponseDto(UUID id, String name, Category category) {}
