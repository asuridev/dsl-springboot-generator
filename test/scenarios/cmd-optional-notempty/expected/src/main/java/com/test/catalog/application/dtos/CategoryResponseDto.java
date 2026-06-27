package com.test.catalog.application.dtos;

import java.util.UUID;

public record CategoryResponseDto(UUID id, String name, String description) {}
