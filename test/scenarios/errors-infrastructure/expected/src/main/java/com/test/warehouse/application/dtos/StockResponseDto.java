package com.test.warehouse.application.dtos;

import java.util.UUID;

public record StockResponseDto(UUID id, String sku, Integer quantity) {}
