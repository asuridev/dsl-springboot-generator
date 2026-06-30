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
    @Query("SELECT c FROM CartJpa c WHERE c.isDefault = true AND c.customerId = :customerId")
    Optional<CartJpa> findDefaultByCustomerId(@Param("customerId") UUID customerId);

    @Query("SELECT c FROM CartJpa c WHERE c.isDefault = false AND c.customerId = :customerId")
    Optional<CartJpa> findNonDefaultByCustomerId(@Param("customerId") UUID customerId);

    @Query("SELECT COUNT(c) FROM CartJpa c WHERE c.isDefault = true AND c.customerId = :customerId")
    long countDefaultByCustomerId(@Param("customerId") UUID customerId);

    @Query(
        "SELECT CASE WHEN COUNT(c) > 0 THEN true ELSE false END FROM CartJpa c WHERE c.isDefault = true AND c.customerId = :customerId"
    )
    boolean existsDefaultByCustomerId(@Param("customerId") UUID customerId);
}
