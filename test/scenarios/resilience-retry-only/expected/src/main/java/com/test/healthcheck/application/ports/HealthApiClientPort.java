package com.test.healthcheck.application.ports;

import com.test.healthcheck.domain.models.healthApi.HealthStatus;

/**
 * Output port — anti-corruption boundary to the health-api bounded context.
 * Implementations live in infrastructure/adapters/healthApi/.
 *
 * <p>This interface is the single dependency point for all health-api interactions:
 * business operations (from health-api-internal-api.yaml) and FK validations.
 */
public interface HealthApiClientPort {
    /**
     * checkHealth
     */
    HealthStatus checkHealth();
}
