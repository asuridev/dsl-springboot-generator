package com.test.subscription.infrastructure.persistence.repositories;

import com.test.subscription.infrastructure.persistence.entities.SubscriptionJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/**
 * SubscriptionJpaRepository — Spring Data JPA repository for SubscriptionJpa.
 * Inherited from JpaRepository: findById, findAll, save, delete, count, etc.
 */
@Repository
public interface SubscriptionJpaRepository extends JpaRepository<SubscriptionJpa, UUID> {}
