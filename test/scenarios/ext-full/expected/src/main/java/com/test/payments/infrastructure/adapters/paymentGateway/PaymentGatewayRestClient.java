package com.test.payments.infrastructure.adapters.paymentGateway;

import com.test.payments.infrastructure.adapters.paymentGateway.dtos.ChargeCardRequestDto;
import com.test.payments.infrastructure.adapters.paymentGateway.dtos.ChargeCardResponseDto;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

/**
 * Feign client for the payment-gateway BC internal API.
 * Returns infrastructure DTOs — never domain models directly.
 * Mapped to domain models by {@link PaymentGatewayAclMapper}.
 */
@FeignClient(
    name = "payment-gateway-client",
    url = "${integration.payment-gateway.base-url}",
    configuration = PaymentGatewayRestConfig.class
)
public interface PaymentGatewayRestClient {
    @PostMapping("/v1/charges")
    ChargeCardResponseDto chargeCard(@RequestBody ChargeCardRequestDto body);

    @PostMapping("/v1/charges/{chargeId}/refund")
    void refundCharge(@PathVariable("chargeId") String chargeId);
}
