package com.test.payment.infrastructure.persistence.repositories;

import com.test.payment.infrastructure.persistence.entities.PaymentJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/**
 * PaymentJpaRepository — Spring Data JPA repository for PaymentJpa.
 * Inherited from JpaRepository: findById, findAll, save, delete, count, etc.
 */
@Repository
public interface PaymentJpaRepository extends JpaRepository<PaymentJpa, UUID> {}
