package com.test.catalog.infrastructure.persistence.repositories;

import com.test.catalog.domain.aggregate.Item;
import com.test.catalog.domain.repository.ItemRepository;
import com.test.catalog.infrastructure.persistence.entities.ItemJpa;
import com.test.catalog.infrastructure.persistence.mappers.ItemJpaMapper;
import com.test.catalog.infrastructure.persistence.repositories.ItemJpaRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * ItemRepositoryImpl — Infrastructure adapter implementing ItemRepository.
 * Bridges the domain repository port with Spring Data JPA. Conversions between
 * the domain model and the JPA model live in ItemJpaMapper so that
 * this adapter can stay focused on persistence orchestration and transactions.
 */
@Component
@Transactional(readOnly = true)
public class ItemRepositoryImpl implements ItemRepository {

    private final ItemJpaRepository jpaRepository;
    private final ItemJpaMapper mapper;

    public ItemRepositoryImpl(ItemJpaRepository jpaRepository, ItemJpaMapper mapper) {
        this.jpaRepository = jpaRepository;
        this.mapper = mapper;
    }

    // ─── Repository methods ───────────────────────────────────────────────────

    @Override
    @Transactional
    public Item save(Item item) {
        return mapper.toDomain(jpaRepository.save(mapper.toJpa(item)));
    }
}
