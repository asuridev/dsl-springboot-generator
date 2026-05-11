package com.test.item.infrastructure.persistence.repositories;

import com.test.item.domain.aggregate.Item;
import com.test.item.domain.repository.ItemRepository;
import com.test.item.infrastructure.persistence.entities.ItemJpa;
import com.test.item.infrastructure.persistence.mappers.ItemJpaMapper;
import com.test.item.infrastructure.persistence.repositories.ItemJpaRepository;
import java.util.Optional;
import java.util.UUID;
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

    @Override
    public Optional<Item> findById(UUID id) {
        return jpaRepository.findById(id).map(mapper::toDomain);
    }
}
