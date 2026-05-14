package com.test.orders.infrastructure.adapters.catalog.dtos;

import com.test.orders.infrastructure.adapters.catalog.dtos.CustomerInfoDto;

/**
 * Infrastructure DTO — shape of the OrderSummaryResultDto response from catalog BC.
 * Only used inside the adapter layer; never exposed to application or domain layers.
 */
public record OrderSummaryResultDto(String orderId, java.math.BigDecimal totalAmount, CustomerInfoDto customer) {}
