package com.test.payments.infrastructure.adapters.authService;

import com.test.payments.application.ports.AuthServiceClientPort;
import org.springframework.stereotype.Component;

/**
 * Feign adapter — infrastructure implementation of {@link AuthServiceClientPort}.
 * Delegates HTTP calls to {@link AuthServiceRestClient} and maps
 * infrastructure DTOs to domain models via {@link AuthServiceAclMapper}.
 */
@Component
public class AuthServiceAclAdapter implements AuthServiceClientPort {

    private final AuthServiceRestClient feignClient;
    private final AuthServiceAclMapper aclMapper;

    public AuthServiceAclAdapter(AuthServiceRestClient feignClient, AuthServiceAclMapper aclMapper) {
        this.feignClient = feignClient;
        this.aclMapper = aclMapper;
    }

    @Override
    public void createInvoice() {
        feignClient.createInvoice();
    }
}
