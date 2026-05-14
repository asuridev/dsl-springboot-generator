package com.test.billing.infrastructure.adapters.orders.dtos;

import com.test.billing.infrastructure.adapters.orders.dtos.OrderLineItemDto;
import java.util.List;

/**
 * Infrastructure DTO — shape of the OrderDetailsResultDto response from orders BC.
 * Only used inside the adapter layer; never exposed to application or domain layers.
 */
public record OrderDetailsResultDto(
    String orderId,
    java.math.BigDecimal totalAmount,
    List<OrderLineItemDto> lineItems
) {}
