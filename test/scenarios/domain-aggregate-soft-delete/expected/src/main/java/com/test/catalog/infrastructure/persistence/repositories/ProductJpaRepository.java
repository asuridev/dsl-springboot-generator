package com.test.catalog.infrastructure.persistence.repositories;

import com.test.catalog.infrastructure.persistence.entities.ProductJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * ProductJpaRepository — Spring Data JPA repository for ProductJpa.
 * Inherited from JpaRepository: findById, findAll, save, delete, count, etc.
 */
@Repository
public interface ProductJpaRepository extends JpaRepository<ProductJpa, UUID> {
    @Modifying
    @Transactional
    @Query("UPDATE ProductJpa a SET a.deletedAt = CURRENT_TIMESTAMP WHERE a.id = :id AND a.deletedAt IS NULL")
    void softDelete(@Param("id") UUID id);
}
