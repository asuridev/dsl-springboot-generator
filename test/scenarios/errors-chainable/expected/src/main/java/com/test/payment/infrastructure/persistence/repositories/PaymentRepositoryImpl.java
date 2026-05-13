package com.test.payment.infrastructure.persistence.repositories;

import com.test.payment.domain.aggregate.Payment;
import com.test.payment.domain.repository.PaymentRepository;
import com.test.payment.infrastructure.persistence.entities.PaymentJpa;
import com.test.payment.infrastructure.persistence.mappers.PaymentJpaMapper;
import com.test.payment.infrastructure.persistence.repositories.PaymentJpaRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * PaymentRepositoryImpl — Infrastructure adapter implementing PaymentRepository.
 * Bridges the domain repository port with Spring Data JPA. Conversions between
 * the domain model and the JPA model live in PaymentJpaMapper so that
 * this adapter can stay focused on persistence orchestration and transactions.
 */
@Component
@Transactional(readOnly = true)
public class PaymentRepositoryImpl implements PaymentRepository {

    private final PaymentJpaRepository jpaRepository;
    private final PaymentJpaMapper mapper;

    public PaymentRepositoryImpl(PaymentJpaRepository jpaRepository, PaymentJpaMapper mapper) {
        this.jpaRepository = jpaRepository;
        this.mapper = mapper;
    }

    // ─── Repository methods ───────────────────────────────────────────────────

    @Override
    @Transactional
    public Payment save(Payment payment) {
        return mapper.toDomain(jpaRepository.save(mapper.toJpa(payment)));
    }

    @Override
    public Optional<Payment> findById(UUID id) {
        return jpaRepository.findById(id).map(mapper::toDomain);
    }
}
