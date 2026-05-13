package com.test.invoice.infrastructure.persistence.repositories;

import com.test.invoice.domain.aggregate.Invoice;
import com.test.invoice.domain.repository.InvoiceRepository;
import com.test.invoice.infrastructure.persistence.entities.InvoiceJpa;
import com.test.invoice.infrastructure.persistence.mappers.InvoiceJpaMapper;
import com.test.invoice.infrastructure.persistence.repositories.InvoiceJpaRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * InvoiceRepositoryImpl — Infrastructure adapter implementing InvoiceRepository.
 * Bridges the domain repository port with Spring Data JPA. Conversions between
 * the domain model and the JPA model live in InvoiceJpaMapper so that
 * this adapter can stay focused on persistence orchestration and transactions.
 */
@Component
@Transactional(readOnly = true)
public class InvoiceRepositoryImpl implements InvoiceRepository {

    private final InvoiceJpaRepository jpaRepository;
    private final InvoiceJpaMapper mapper;

    public InvoiceRepositoryImpl(InvoiceJpaRepository jpaRepository, InvoiceJpaMapper mapper) {
        this.jpaRepository = jpaRepository;
        this.mapper = mapper;
    }

    // ─── Repository methods ───────────────────────────────────────────────────

    @Override
    @Transactional
    public Invoice save(Invoice invoice) {
        return mapper.toDomain(jpaRepository.save(mapper.toJpa(invoice)));
    }

    @Override
    public Optional<Invoice> findById(UUID id) {
        return jpaRepository.findById(id).map(mapper::toDomain);
    }
}
