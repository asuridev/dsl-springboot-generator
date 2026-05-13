package com.test.order.infrastructure.persistence.repositories;

import com.test.order.domain.aggregate.Order;
import com.test.order.domain.repository.OrderRepository;
import com.test.order.infrastructure.persistence.entities.OrderJpa;
import com.test.order.infrastructure.persistence.mappers.OrderJpaMapper;
import com.test.order.infrastructure.persistence.repositories.OrderJpaRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * OrderRepositoryImpl — Infrastructure adapter implementing OrderRepository.
 * Bridges the domain repository port with Spring Data JPA. Conversions between
 * the domain model and the JPA model live in OrderJpaMapper so that
 * this adapter can stay focused on persistence orchestration and transactions.
 */
@Component
@Transactional(readOnly = true)
public class OrderRepositoryImpl implements OrderRepository {

    private final OrderJpaRepository jpaRepository;
    private final OrderJpaMapper mapper;

    public OrderRepositoryImpl(OrderJpaRepository jpaRepository, OrderJpaMapper mapper) {
        this.jpaRepository = jpaRepository;
        this.mapper = mapper;
    }

    // ─── Repository methods ───────────────────────────────────────────────────

    @Override
    public Optional<Order> findByReference(String reference) {
        return jpaRepository.findByReference(reference).map(mapper::toDomain);
    }

    @Override
    @Transactional
    public Order save(Order order) {
        return mapper.toDomain(jpaRepository.save(mapper.toJpa(order)));
    }

    @Override
    public Optional<Order> findById(UUID id) {
        return jpaRepository.findById(id).map(mapper::toDomain);
    }
}
