package com.test.orders.infrastructure.persistence.projections;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

/**
 * Spring Data repository for LocalProductViewJpa.
 * derived_from: bc.orders.projections[LocalProductView] (persistent: true)
 */
@Repository
public interface LocalProductViewJpaRepository extends JpaRepository<LocalProductViewJpa, UUID> {}
