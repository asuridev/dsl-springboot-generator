package com.test.dashboard.infrastructure.persistence.projections;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import lombok.*;

/**
 * ServiceMetricsJpa — persistent local read model.
 * derived_from: bc.dashboard.projections[ServiceMetrics] (persistent: true)
 * source: monitoring.domainEvents.published[ServiceCheckCompleted]
 * key: serviceId
 * upsert: lastWriteWins
 *
 * Local read model of service health metrics.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "proj_service_metrics")
public class ServiceMetricsJpa {

    @Id
    @Column(name = "service_id", nullable = false, updatable = false)
    private UUID serviceId;

    @Column(name = "average_latency", nullable = false)
    private Duration averageLatency;

    @Column(name = "dashboard_url", columnDefinition = "TEXT")
    private URI dashboardUrl;

    @Column(name = "score", precision = 5, scale = 2, nullable = false)
    private BigDecimal score;

    @Column(name = "last_updated_at", nullable = false)
    private Instant lastUpdatedAt;
}
