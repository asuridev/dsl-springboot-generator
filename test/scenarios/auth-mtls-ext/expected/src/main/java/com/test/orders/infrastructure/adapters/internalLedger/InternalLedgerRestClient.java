package com.test.orders.infrastructure.adapters.internalLedger;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

/**
 * Feign client for the internal-ledger BC internal API.
 * Returns infrastructure DTOs — never domain models directly.
 * Mapped to domain models by {@link InternalLedgerAclMapper}.
 */
@FeignClient(
    name = "internal-ledger-client",
    url = "${integration.internal-ledger.base-url}",
    configuration = InternalLedgerRestConfig.class
)
public interface InternalLedgerRestClient {
    @GetMapping("/v1/balance")
    void getBalance();
}
