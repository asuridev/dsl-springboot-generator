package com.test.catalog.infrastructure.persistence.repositories;

import com.test.catalog.domain.enums.ProductStatus;
import com.test.catalog.infrastructure.persistence.entities.ProductJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/**
 * ProductJpaRepository — Spring Data JPA repository for ProductJpa.
 * Inherited from JpaRepository: findById, findAll, save, delete, count, etc.
 */
@Repository
public interface ProductJpaRepository extends JpaRepository<ProductJpa, UUID> {
    // derived_from: openapi:listMyProducts
    @Query("SELECT p FROM ProductJpa p WHERE p.ownerId = :ownerId AND (:status IS NULL OR p.status = :status)")
    Page<ProductJpa> list(@Param("ownerId") UUID ownerId, @Param("status") ProductStatus status, Pageable page);
}
