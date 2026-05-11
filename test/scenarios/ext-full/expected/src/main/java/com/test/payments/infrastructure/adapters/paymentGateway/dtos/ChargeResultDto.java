package com.test.payments.infrastructure.adapters.paymentGateway.dtos;

import java.util.List;

// derived_from: system.yaml#/externalSystems/payment-gateway/schemas/ChargeResult
/**
 * Wire-format DTO for the payment-gateway external API.
 * Internal to the adapter layer — never exposed to application or domain.
 */
public record ChargeResultDto(String chargeId, String status, List<SplitDetailDto> splits) {}
