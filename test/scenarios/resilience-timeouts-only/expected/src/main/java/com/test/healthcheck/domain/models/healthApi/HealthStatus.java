package com.test.healthcheck.domain.models.healthApi;

// derived_from: system.yaml#/externalSystems/health-api/operations/checkHealth/domain
/**
 * Domain model for {@code HealthStatus} returned from {@link HealthApiAclMapper}.
 *
 * <p>This is the domain-side view of the external health-api response.
 * The corresponding wire-format DTO lives under
 * {@code infrastructure.adapters.healthApi.dtos}.
 * If the external API changes, only the ACL mapper needs updating.
 */
public record HealthStatus(String status) {}
