package com.test.payments.infrastructure.adapters.paymentGateway.dtos;

// derived_from: system.yaml#/externalSystems/payment-gateway/operations/chargeCard/response
/**
 * Wire-format DTO for the payment-gateway external API.
 * Internal to the adapter layer — never exposed to application or domain.
 */
public record ChargeCardResponseDto(ChargeResultDto result) {}
