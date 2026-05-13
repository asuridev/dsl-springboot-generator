package com.test.payments.application.ports;

import com.test.payments.domain.models.paymentGateway.ChargeResult;
import com.test.payments.infrastructure.adapters.paymentGateway.dtos.ChargeCardRequestDto;

/**
 * Output port — anti-corruption boundary to the payment-gateway bounded context.
 * Implementations live in infrastructure/adapters/paymentGateway/.
 *
 * <p>This interface is the single dependency point for all payment-gateway interactions:
 * business operations (from payment-gateway-internal-api.yaml) and FK validations.
 */
public interface PaymentGatewayClientPort {
    /**
     * chargeCard
     */
    ChargeResult chargeCard(ChargeCardRequestDto body);

    /**
     * refundCharge
     */
    void refundCharge(String chargeId);
}
