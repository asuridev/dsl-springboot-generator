package com.test.inventory.application.dtos;

import java.util.UUID;

public record InventoryItemResponseDto(UUID id, UUID productId, Integer stock) {}
