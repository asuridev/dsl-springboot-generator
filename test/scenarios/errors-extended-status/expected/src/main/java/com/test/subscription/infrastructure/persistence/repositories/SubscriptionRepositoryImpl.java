package com.test.subscription.infrastructure.persistence.repositories;

import com.test.subscription.domain.aggregate.Subscription;
import com.test.subscription.domain.repository.SubscriptionRepository;
import com.test.subscription.infrastructure.persistence.entities.SubscriptionJpa;
import com.test.subscription.infrastructure.persistence.mappers.SubscriptionJpaMapper;
import com.test.subscription.infrastructure.persistence.repositories.SubscriptionJpaRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * SubscriptionRepositoryImpl — Infrastructure adapter implementing SubscriptionRepository.
 * Bridges the domain repository port with Spring Data JPA. Conversions between
 * the domain model and the JPA model live in SubscriptionJpaMapper so that
 * this adapter can stay focused on persistence orchestration and transactions.
 */
@Component
@Transactional(readOnly = true)
public class SubscriptionRepositoryImpl implements SubscriptionRepository {

    private final SubscriptionJpaRepository jpaRepository;
    private final SubscriptionJpaMapper mapper;

    public SubscriptionRepositoryImpl(SubscriptionJpaRepository jpaRepository, SubscriptionJpaMapper mapper) {
        this.jpaRepository = jpaRepository;
        this.mapper = mapper;
    }

    // ─── Repository methods ───────────────────────────────────────────────────

    @Override
    @Transactional
    public Subscription save(Subscription subscription) {
        return mapper.toDomain(jpaRepository.save(mapper.toJpa(subscription)));
    }

    @Override
    public Optional<Subscription> findById(UUID id) {
        return jpaRepository.findById(id).map(mapper::toDomain);
    }
}
