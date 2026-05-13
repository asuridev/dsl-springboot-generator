package com.test.invoice.infrastructure.persistence.repositories;

import com.test.invoice.infrastructure.persistence.entities.InvoiceJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/**
 * InvoiceJpaRepository — Spring Data JPA repository for InvoiceJpa.
 * Inherited from JpaRepository: findById, findAll, save, delete, count, etc.
 */
@Repository
public interface InvoiceJpaRepository extends JpaRepository<InvoiceJpa, UUID> {}
