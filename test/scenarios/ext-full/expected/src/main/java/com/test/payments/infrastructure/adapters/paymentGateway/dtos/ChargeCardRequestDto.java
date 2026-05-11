package com.test.payments.infrastructure.adapters.paymentGateway.dtos;

import java.math.BigDecimal;

// derived_from: system.yaml#/externalSystems/payment-gateway/operations/chargeCard/request
/**
 * Wire-format DTO for the payment-gateway external API.
 * Internal to the adapter layer — never exposed to application or domain.
 */
public record ChargeCardRequestDto(String cardToken, BigDecimal amount) {}
