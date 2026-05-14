package com.test.inventory.application.dtos;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Local read model of product stock levels with version-guarded upserts.
 */

// derived_from: projection:ProductStock

public record ProductStock(UUID productId, Integer quantity, Integer reservedQuantity, BigDecimal unitCost) {}
