package com.test.healthcheck.infrastructure.adapters.healthApi;

import com.test.healthcheck.domain.models.healthApi.HealthStatus;
import com.test.healthcheck.infrastructure.adapters.healthApi.dtos.CheckHealthResponseDto;
import org.springframework.stereotype.Component;

// derived_from: system.yaml#/externalSystems/health-api
/**
 * ACL (Anti-Corruption Layer) mapper for {@link HealthApiClientPort}.
 *
 * <p>Translates wire-format DTOs from the health-api external API into
 * domain models. The provider's wire format and error semantics never reach
 * the domain — they stop here.
 *
 * <p>Each mapping method is generated as a scaffold ({@code // TODO}). Implement
 * the translation manually because external responses often require domain
 * decisions (status normalization, error code mapping, derived fields) that
 * cannot be generated deterministically.
 */
@Component
public class HealthApiAclMapper {

    /**
     */
    public HealthStatus toHealthStatus(CheckHealthResponseDto dto) {
        if (dto == null) return null;
        // TODO: implement mapping — see system.yaml#/externalSystems/health-api/operations/checkHealth
        throw new UnsupportedOperationException("checkHealth ACL mapping not implemented yet");
    }
}
