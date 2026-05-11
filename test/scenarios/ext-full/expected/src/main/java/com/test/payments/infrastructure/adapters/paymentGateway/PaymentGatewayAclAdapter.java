package com.test.payments.infrastructure.adapters.paymentGateway;

import com.test.payments.application.ports.PaymentGatewayClientPort;
import com.test.payments.domain.models.paymentGateway.ChargeResult;
import com.test.payments.infrastructure.adapters.paymentGateway.dtos.ChargeCardRequestDto;
import io.github.resilience4j.circuitbreaker.annotation.CircuitBreaker;
import io.github.resilience4j.retry.annotation.Retry;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Feign adapter — infrastructure implementation of {@link PaymentGatewayClientPort}.
 * Delegates HTTP calls to {@link PaymentGatewayRestClient} and maps
 * infrastructure DTOs to domain models via {@link PaymentGatewayAclMapper}.
 *
 * derived_from: system.yaml#/integrations[from=payments,to=payment-gateway]/resilience
 */
@Component
public class PaymentGatewayAclAdapter implements PaymentGatewayClientPort {

    private final PaymentGatewayRestClient feignClient;
    private final PaymentGatewayAclMapper aclMapper;

    public PaymentGatewayAclAdapter(PaymentGatewayRestClient feignClient, PaymentGatewayAclMapper aclMapper) {
        this.feignClient = feignClient;
        this.aclMapper = aclMapper;
    }

    @Override
    @CircuitBreaker(name = "payment-gateway", fallbackMethod = "chargeCardFallback")
    @Retry(name = "payment-gateway")
    public ChargeResult chargeCard(ChargeCardRequestDto body) {
        return aclMapper.toChargeResult(feignClient.chargeCard(body));
    }

    /**
     * Resilience fallback for {@link #chargeCard}.
     * Invoked when the circuit-breaker is open or after retries are exhausted.
     */
    @SuppressWarnings("unused")
    private ChargeResult chargeCardFallback(ChargeCardRequestDto body, Throwable cause) {
        // TODO: implement fallback for chargeCard — derived_from: resilience.fallback
        throw new UnsupportedOperationException("Fallback for chargeCard not implemented yet", cause);
    }

    @Override
    @CircuitBreaker(name = "payment-gateway", fallbackMethod = "refundChargeFallback")
    @Retry(name = "payment-gateway")
    public void refundCharge(String chargeId) {
        feignClient.refundCharge(chargeId);
    }

    /**
     * Resilience fallback for {@link #refundCharge}.
     * Invoked when the circuit-breaker is open or after retries are exhausted.
     */
    @SuppressWarnings("unused")
    private void refundChargeFallback(String chargeId, Throwable cause) {
        // TODO: implement fallback for refundCharge — derived_from: resilience.fallback
        throw new UnsupportedOperationException("Fallback for refundCharge not implemented yet", cause);
    }
}
