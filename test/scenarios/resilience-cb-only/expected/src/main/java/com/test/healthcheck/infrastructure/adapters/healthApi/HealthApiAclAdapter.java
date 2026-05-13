package com.test.healthcheck.infrastructure.adapters.healthApi;

import com.test.healthcheck.application.ports.HealthApiClientPort;
import com.test.healthcheck.domain.models.healthApi.HealthStatus;
import io.github.resilience4j.circuitbreaker.annotation.CircuitBreaker;
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
    @CircuitBreaker(name = "health-api", fallbackMethod = "checkHealthFallback")
    public HealthStatus checkHealth() {
        return aclMapper.toHealthStatus(feignClient.checkHealth());
    }

    /**
     * Resilience fallback for {@link #checkHealth}.
     * Invoked when the circuit-breaker is open or after retries are exhausted.
     */
    @SuppressWarnings("unused")
    private HealthStatus checkHealthFallback(Throwable cause) {
        // TODO: implement fallback for checkHealth — derived_from: resilience.fallback
        throw new UnsupportedOperationException("Fallback for checkHealth not implemented yet", cause);
    }
}
