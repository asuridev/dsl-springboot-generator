package com.test.orders.infrastructure.persistence.repositories;

import com.test.orders.infrastructure.persistence.entities.CartJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/**
 * CartJpaRepository — Spring Data JPA repository for CartJpa.
 * Inherited from JpaRepository: findById, findAll, save, delete, count, etc.
 */
@Repository
public interface CartJpaRepository extends JpaRepository<CartJpa, UUID> {
    @Query("SELECT c FROM CartJpa c WHERE c.status = 'ACTIVE' AND c.customerId = :customerId")
    Optional<CartJpa> findActiveByCustomerId(@Param("customerId") UUID customerId);
}
