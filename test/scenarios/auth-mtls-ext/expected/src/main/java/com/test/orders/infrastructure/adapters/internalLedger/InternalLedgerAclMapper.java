package com.test.orders.infrastructure.adapters.internalLedger;

import org.springframework.stereotype.Component;

// derived_from: system.yaml#/externalSystems/internal-ledger
/**
 * ACL (Anti-Corruption Layer) mapper for {@link InternalLedgerClientPort}.
 *
 * <p>Translates wire-format DTOs from the internal-ledger external API into
 * domain models. The provider's wire format and error semantics never reach
 * the domain — they stop here.
 *
 * <p>Each mapping method is generated as a scaffold ({@code // TODO}). Implement
 * the translation manually because external responses often require domain
 * decisions (status normalization, error code mapping, derived fields) that
 * cannot be generated deterministically.
 */
@Component
public class InternalLedgerAclMapper {}
