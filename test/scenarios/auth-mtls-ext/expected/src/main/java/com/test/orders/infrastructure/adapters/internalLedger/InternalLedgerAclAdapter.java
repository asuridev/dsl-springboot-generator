package com.test.orders.infrastructure.adapters.internalLedger;

import com.test.orders.application.ports.InternalLedgerClientPort;
import org.springframework.stereotype.Component;

/**
 * Feign adapter — infrastructure implementation of {@link InternalLedgerClientPort}.
 * Delegates HTTP calls to {@link InternalLedgerRestClient} and maps
 * infrastructure DTOs to domain models via {@link InternalLedgerAclMapper}.
 */
@Component
public class InternalLedgerAclAdapter implements InternalLedgerClientPort {

    private final InternalLedgerRestClient feignClient;
    private final InternalLedgerAclMapper aclMapper;

    public InternalLedgerAclAdapter(InternalLedgerRestClient feignClient, InternalLedgerAclMapper aclMapper) {
        this.feignClient = feignClient;
        this.aclMapper = aclMapper;
    }

    @Override
    public void getBalance() {
        feignClient.getBalance();
    }
}
