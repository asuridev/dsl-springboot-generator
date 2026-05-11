package com.test.payments.infrastructure.adapters.authService;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

/**
 * Feign client for the auth-service BC internal API.
 * Returns infrastructure DTOs — never domain models directly.
 * Mapped to domain models by {@link AuthServiceAclMapper}.
 */
@FeignClient(
    name = "auth-service-client",
    url = "${integration.auth-service.base-url}",
    configuration = AuthServiceRestConfig.class
)
public interface AuthServiceRestClient {
    @PostMapping("/v1/invoices")
    void createInvoice();
}
