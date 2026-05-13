package com.test.warehouse.infrastructure.persistence.repositories;

import com.test.warehouse.infrastructure.persistence.entities.StockJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/**
 * StockJpaRepository — Spring Data JPA repository for StockJpa.
 * Inherited from JpaRepository: findById, findAll, save, delete, count, etc.
 */
@Repository
public interface StockJpaRepository extends JpaRepository<StockJpa, UUID> {}
