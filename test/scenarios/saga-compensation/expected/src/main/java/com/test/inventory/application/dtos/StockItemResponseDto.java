package com.test.inventory.application.dtos;

import java.util.UUID;

public record StockItemResponseDto(UUID id, UUID orderId) {}
