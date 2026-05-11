package com.test.payments.infrastructure.adapters.paymentGateway.dtos;

import java.math.BigDecimal;

// derived_from: system.yaml#/externalSystems/payment-gateway/schemas/SplitDetail
/**
 * Wire-format DTO for the payment-gateway external API.
 * Internal to the adapter layer — never exposed to application or domain.
 */
public record SplitDetailDto(String merchantId, BigDecimal amount, BigDecimal percentage) {}
