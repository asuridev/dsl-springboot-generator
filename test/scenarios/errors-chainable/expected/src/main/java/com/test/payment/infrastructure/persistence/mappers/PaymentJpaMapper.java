package com.test.payment.infrastructure.persistence.mappers;

import com.test.payment.domain.aggregate.Payment;
import com.test.payment.infrastructure.persistence.entities.PaymentJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * PaymentJpaMapper — stateless converter between the domain model
 * and its JPA representation.
 *
 * Extracted from PaymentRepositoryImpl to keep the adapter focused
 * on persistence orchestration. All conversions are pure functions; introduce
 * dependencies (e.g. value-object factories) only if a domain rule explicitly
 * requires them.
 */
@Component
public class PaymentJpaMapper {

    // ─── JPA → Domain ────────────────────────────────────────────────────────

    public Payment toDomain(PaymentJpa jpa) {
        return new Payment(jpa.getId(), jpa.getAmount());
    }

    // ─── Domain → JPA ────────────────────────────────────────────────────────

    public PaymentJpa toJpa(Payment domain) {
        PaymentJpa jpa = PaymentJpa.builder().id(domain.getId()).amount(domain.getAmount()).build();
        return jpa;
    }
}
