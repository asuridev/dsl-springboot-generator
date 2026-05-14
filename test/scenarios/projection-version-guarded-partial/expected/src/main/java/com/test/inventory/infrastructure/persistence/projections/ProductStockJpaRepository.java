package com.test.inventory.infrastructure.persistence.projections;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

/**
 * Spring Data repository for ProductStockJpa.
 * derived_from: bc.inventory.projections[ProductStock] (persistent: true)
 */
@Repository
public interface ProductStockJpaRepository extends JpaRepository<ProductStockJpa, UUID> {}
