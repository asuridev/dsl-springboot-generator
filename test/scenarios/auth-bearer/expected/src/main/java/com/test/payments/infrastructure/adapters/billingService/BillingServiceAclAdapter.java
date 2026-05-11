package com.test.payments.infrastructure.adapters.billingService;

import com.test.payments.application.ports.BillingServiceClientPort;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Feign adapter — infrastructure implementation of {@link BillingServiceClientPort}.
 * Delegates HTTP calls to {@link BillingServiceRestClient} and maps
 * infrastructure DTOs to domain models via {@link BillingServiceAclMapper}.
 */
@Component
public class BillingServiceAclAdapter implements BillingServiceClientPort {

    private final BillingServiceRestClient feignClient;
    private final BillingServiceAclMapper aclMapper;

    public BillingServiceAclAdapter(BillingServiceRestClient feignClient, BillingServiceAclMapper aclMapper) {
        this.feignClient = feignClient;
        this.aclMapper = aclMapper;
    }

    @Override
    public void createInvoice() {
        feignClient.createInvoice();
    }
}
