package com.test.item.infrastructure.persistence.repositories;

import com.test.item.infrastructure.persistence.entities.ItemJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/**
 * ItemJpaRepository — Spring Data JPA repository for ItemJpa.
 * Inherited from JpaRepository: findById, findAll, save, delete, count, etc.
 */
@Repository
public interface ItemJpaRepository extends JpaRepository<ItemJpa, UUID> {}
