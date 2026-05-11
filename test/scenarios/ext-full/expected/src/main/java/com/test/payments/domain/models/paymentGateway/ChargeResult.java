package com.test.payments.domain.models.paymentGateway;

// derived_from: system.yaml#/externalSystems/payment-gateway/operations/chargeCard/domain
/**
 * Domain model for {@code ChargeResult} returned from {@link PaymentGatewayAclMapper}.
 *
 * <p>This is the domain-side view of the external payment-gateway response.
 * The corresponding wire-format DTO lives under
 * {@code infrastructure.adapters.paymentGateway.dtos}.
 * If the external API changes, only the ACL mapper needs updating.
 */
public record ChargeResult(
    // source: dto.result
    String chargeId,
    // source: dto.result
    String paymentStatus
) {}
