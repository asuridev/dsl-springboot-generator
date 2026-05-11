package com.test.healthcheck.infrastructure.adapters.healthApi;

import com.test.healthcheck.application.ports.HealthApiClientPort;
import com.test.healthcheck.domain.models.healthApi.HealthStatus;
import io.github.resilience4j.retry.annotation.Retry;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Feign adapter — infrastructure implementation of {@link HealthApiClientPort}.
 * Delegates HTTP calls to {@link HealthApiRestClient} and maps
 * infrastructure DTOs to domain models via {@link HealthApiAclMapper}.
 *
 * derived_from: system.yaml#/integrations[from=healthcheck,to=health-api]/resilience
 */
@Component
public class HealthApiAclAdapter implements HealthApiClientPort {

    private final HealthApiRestClient feignClient;
    private final HealthApiAclMapper aclMapper;

    public HealthApiAclAdapter(HealthApiRestClient feignClient, HealthApiAclMapper aclMapper) {
        this.feignClient = feignClient;
        this.aclMapper = aclMapper;
    }

    @Override
    @Retry(name = "health-api")
    public HealthStatus checkHealth() {
        return aclMapper.toHealthStatus(feignClient.checkHealth());
    }
}
