package com.test.catalog.infrastructure.persistence.repositories;

import com.test.catalog.infrastructure.persistence.entities.CategoryJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/**
 * CategoryJpaRepository — Spring Data JPA repository for CategoryJpa.
 * Inherited from JpaRepository: findById, findAll, save, delete, count, etc.
 */
@Repository
public interface CategoryJpaRepository extends JpaRepository<CategoryJpa, UUID> {}
