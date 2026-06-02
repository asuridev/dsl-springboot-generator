package com.test.catalog.infrastructure.adapters.orderHub.dtos;

// derived_from: system.yaml#/externalSystems/order-hub/operations/getOrderSummary/response
/**
 * Wire-format DTO for the order-hub external API.
 * Internal to the adapter layer — never exposed to application or domain.
 */
public record GetOrderSummaryResponseDto(String status, Integer lineCount) {}
