package com.test.orders.application.dtos;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Local read model of products maintained by catalog events via Kafka.
 */

// derived_from: projection:LocalProductView

public record LocalProductView(UUID productId, String productName, BigDecimal price) {}
