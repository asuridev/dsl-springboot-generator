package com.test.orders.infrastructure.persistence.repositories;

import com.test.orders.domain.aggregate.Cart;
import com.test.orders.domain.repository.CartRepository;
import com.test.orders.infrastructure.persistence.entities.CartJpa;
import com.test.orders.infrastructure.persistence.mappers.CartJpaMapper;
import com.test.orders.infrastructure.persistence.repositories.CartJpaRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * CartRepositoryImpl — Infrastructure adapter implementing CartRepository.
 * Bridges the domain repository port with Spring Data JPA. Conversions between
 * the domain model and the JPA model live in CartJpaMapper so that
 * this adapter can stay focused on persistence orchestration and transactions.
 */
@Component
@Transactional(readOnly = true)
public class CartRepositoryImpl implements CartRepository {

    private final CartJpaRepository jpaRepository;
    private final CartJpaMapper mapper;

    public CartRepositoryImpl(CartJpaRepository jpaRepository, CartJpaMapper mapper) {
        this.jpaRepository = jpaRepository;
        this.mapper = mapper;
    }

    // ─── Repository methods ───────────────────────────────────────────────────

    @Override
    public Optional<Cart> findDefaultByCustomerId(UUID customerId) {
        return jpaRepository.findDefaultByCustomerId(customerId).map(mapper::toDomain);
    }

    @Override
    public Optional<Cart> findNonDefaultByCustomerId(UUID customerId) {
        return jpaRepository.findNonDefaultByCustomerId(customerId).map(mapper::toDomain);
    }

    @Override
    public long countDefaultByCustomerId(UUID customerId) {
        return jpaRepository.countDefaultByCustomerId(customerId);
    }

    @Override
    public boolean existsDefaultByCustomerId(UUID customerId) {
        return jpaRepository.existsDefaultByCustomerId(customerId);
    }

    @Override
    public Optional<Cart> findById(UUID id) {
        return jpaRepository.findById(id).map(mapper::toDomain);
    }
}
