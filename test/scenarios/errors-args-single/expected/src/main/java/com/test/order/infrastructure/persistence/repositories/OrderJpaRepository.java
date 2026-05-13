package com.test.order.infrastructure.persistence.repositories;

import com.test.order.infrastructure.persistence.entities.OrderJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/**
 * OrderJpaRepository — Spring Data JPA repository for OrderJpa.
 * Inherited from JpaRepository: findById, findAll, save, delete, count, etc.
 */
@Repository
public interface OrderJpaRepository extends JpaRepository<OrderJpa, UUID> {
    Optional<OrderJpa> findByReference(String reference);
}
