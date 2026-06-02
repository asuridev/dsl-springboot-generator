package com.test.catalog.infrastructure.persistence.repositories;

import com.test.catalog.infrastructure.persistence.entities.ProductJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Slice;
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
    @Query("SELECT p FROM ProductJpa p WHERE (:name IS NULL OR LOWER(p.name) LIKE LOWER(CONCAT('%', :name, '%')))")
    Slice<ProductJpa> browseProducts(@Param("name") String name);
}
