package com.test.inventory.application.dtos;

import java.util.UUID;

public record ItemResponseDto(UUID id, String sku, Integer quantity) {}
