package com.test.catalog.domain.models.orderHub;

import java.util.List;
import java.util.UUID;

// derived_from: system.yaml#/externalSystems/order-hub/operations/getOrderSummary/domain
/**
 * Domain model for {@code OrderSummary} returned from {@link OrderHubAclMapper}.
 *
 * <p>This is the domain-side view of the external order-hub response.
 * The corresponding wire-format DTO lives under
 * {@code infrastructure.adapters.orderHub.dtos}.
 * If the external API changes, only the ACL mapper needs updating.
 */
public record OrderSummary(List<UUID> lineIds, List<String> tags) {}
