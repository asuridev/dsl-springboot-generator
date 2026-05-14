package com.test.orders.application.dtos;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

public record OrderDetailsResultDto(UUID orderId, BigDecimal totalAmount, List<OrderLineItemDto> lineItems) {}
