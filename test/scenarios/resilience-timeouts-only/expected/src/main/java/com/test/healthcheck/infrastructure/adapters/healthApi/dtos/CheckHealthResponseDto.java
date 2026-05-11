package com.test.healthcheck.infrastructure.adapters.healthApi.dtos;

// derived_from: system.yaml#/externalSystems/health-api/operations/checkHealth/response
/**
 * Wire-format DTO for the health-api external API.
 * Internal to the adapter layer — never exposed to application or domain.
 */
public record CheckHealthResponseDto(String status) {}
