package com.test.payments.infrastructure.adapters.billingService;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

/**
 * Feign client for the billing-service BC internal API.
 * Returns infrastructure DTOs — never domain models directly.
 * Mapped to domain models by {@link BillingServiceAclMapper}.
 */
@FeignClient(
    name = "billing-service-client",
    url = "${integration.billing-service.base-url}",
    configuration = BillingServiceRestConfig.class
)
public interface BillingServiceRestClient {
    @PostMapping("/v1/invoices")
    void createInvoice();
}
