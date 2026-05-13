package com.test.invoice.infrastructure.persistence.mappers;

import com.test.invoice.domain.aggregate.Invoice;
import com.test.invoice.infrastructure.persistence.entities.InvoiceJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * InvoiceJpaMapper — stateless converter between the domain model
 * and its JPA representation.
 *
 * Extracted from InvoiceRepositoryImpl to keep the adapter focused
 * on persistence orchestration. All conversions are pure functions; introduce
 * dependencies (e.g. value-object factories) only if a domain rule explicitly
 * requires them.
 */
@Component
public class InvoiceJpaMapper {

    // ─── JPA → Domain ────────────────────────────────────────────────────────

    public Invoice toDomain(InvoiceJpa jpa) {
        return new Invoice(jpa.getId(), jpa.getNumber(), jpa.getAmount());
    }

    // ─── Domain → JPA ────────────────────────────────────────────────────────

    public InvoiceJpa toJpa(Invoice domain) {
        InvoiceJpa jpa = InvoiceJpa.builder()
            .id(domain.getId())
            .number(domain.getNumber())
            .amount(domain.getAmount())
            .build();
        return jpa;
    }
}
