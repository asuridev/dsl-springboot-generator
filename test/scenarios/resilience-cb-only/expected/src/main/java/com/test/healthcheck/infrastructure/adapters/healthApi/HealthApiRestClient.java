package com.test.healthcheck.infrastructure.adapters.healthApi;

import com.test.healthcheck.infrastructure.adapters.healthApi.dtos.CheckHealthResponseDto;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

/**
 * Feign client for the health-api BC internal API.
 * Returns infrastructure DTOs — never domain models directly.
 * Mapped to domain models by {@link HealthApiAclMapper}.
 */
@FeignClient(
    name = "health-api-client",
    url = "${integration.health-api.base-url}",
    configuration = HealthApiRestConfig.class
)
public interface HealthApiRestClient {
    @GetMapping("/health")
    CheckHealthResponseDto checkHealth();
}
