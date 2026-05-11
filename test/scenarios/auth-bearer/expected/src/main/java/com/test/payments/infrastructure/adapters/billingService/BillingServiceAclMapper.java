package com.test.payments.infrastructure.adapters.billingService;

import org.springframework.stereotype.Component;

// derived_from: system.yaml#/externalSystems/billing-service
/**
 * ACL (Anti-Corruption Layer) mapper for {@link BillingServiceClientPort}.
 *
 * <p>Translates wire-format DTOs from the billing-service external API into
 * domain models. The provider's wire format and error semantics never reach
 * the domain — they stop here.
 *
 * <p>Each mapping method is generated as a scaffold ({@code // TODO}). Implement
 * the translation manually because external responses often require domain
 * decisions (status normalization, error code mapping, derived fields) that
 * cannot be generated deterministically.
 */
@Component
public class BillingServiceAclMapper {}
