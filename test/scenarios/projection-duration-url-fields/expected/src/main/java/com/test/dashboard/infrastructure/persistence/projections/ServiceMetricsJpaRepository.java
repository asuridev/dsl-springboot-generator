package com.test.dashboard.infrastructure.persistence.projections;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

/**
 * Spring Data repository for ServiceMetricsJpa.
 * derived_from: bc.dashboard.projections[ServiceMetrics] (persistent: true)
 */
@Repository
public interface ServiceMetricsJpaRepository extends JpaRepository<ServiceMetricsJpa, UUID> {}
