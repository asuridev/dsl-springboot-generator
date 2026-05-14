package com.test.catalog.application.dtos;

import java.math.BigDecimal;
import java.util.UUID;

public record OrderSummaryResultDto(UUID orderId, BigDecimal totalAmount, CustomerInfoDto customer) {}
