package com.test.catalog.infrastructure.persistence.repositories;

import com.test.catalog.infrastructure.persistence.entities.ProductJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/**
 * ProductJpaRepository — Spring Data JPA repository for ProductJpa.
 * Inherited from JpaRepository: findById, findAll, save, delete, count, etc.
 */
@Repository
public interface ProductJpaRepository extends JpaRepository<ProductJpa, UUID>, JpaSpecificationExecutor<ProductJpa> {}
