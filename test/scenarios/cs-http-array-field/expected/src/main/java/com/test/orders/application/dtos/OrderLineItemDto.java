package com.test.orders.application.dtos;

import java.math.BigDecimal;
import java.util.UUID;

public record OrderLineItemDto(UUID productId, int quantity, BigDecimal unitPrice) {}
