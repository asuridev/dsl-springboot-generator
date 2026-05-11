package com.test.payments.infrastructure.adapters.paymentGateway;

import com.test.payments.domain.models.paymentGateway.ChargeResult;
import com.test.payments.infrastructure.adapters.paymentGateway.dtos.ChargeCardResponseDto;
import org.springframework.stereotype.Component;

// derived_from: system.yaml#/externalSystems/payment-gateway
/**
 * ACL (Anti-Corruption Layer) mapper for {@link PaymentGatewayClientPort}.
 *
 * <p>Translates wire-format DTOs from the payment-gateway external API into
 * domain models. The provider's wire format and error semantics never reach
 * the domain — they stop here.
 *
 * <p>Each mapping method is generated as a scaffold ({@code // TODO}). Implement
 * the translation manually because external responses often require domain
 * decisions (status normalization, error code mapping, derived fields) that
 * cannot be generated deterministically.
 */
@Component
public class PaymentGatewayAclMapper {

    /**
     * <code>chargeId</code> ← {@code dto.result()}
     * <code>paymentStatus</code> ← {@code dto.result()}
     */
    public ChargeResult toChargeResult(ChargeCardResponseDto dto) {
        if (dto == null) return null;
        // TODO: implement mapping — see system.yaml#/externalSystems/payment-gateway/operations/chargeCard
        throw new UnsupportedOperationException("chargeCard ACL mapping not implemented yet");
    }

    // Request mapping (domain → wire) is intentionally left to the adapter caller.
    // If a domain command type is needed in a future phase, generate {@code toChargeCardRequestDto()} here.
}
