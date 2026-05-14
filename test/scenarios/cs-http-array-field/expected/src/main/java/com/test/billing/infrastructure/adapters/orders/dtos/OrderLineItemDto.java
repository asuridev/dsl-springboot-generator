package com.test.billing.infrastructure.adapters.orders.dtos;

/**
 * Infrastructure DTO — shape of the OrderLineItemDto response from orders BC.
 * Only used inside the adapter layer; never exposed to application or domain layers.
 */
public record OrderLineItemDto(String productId, int quantity, java.math.BigDecimal unitPrice) {}
