package com.test.dashboard.application.dtos;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.UUID;

/**
 * Local read model of service health metrics.
 */

// derived_from: projection:ServiceMetrics

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ServiceMetrics(UUID serviceId, Duration averageLatency, String dashboardUrl, BigDecimal score) {}
