package com.test.inventory.infrastructure.persistence.repositories;

import com.test.inventory.domain.aggregate.Item;
import com.test.inventory.domain.repository.ItemRepository;
import com.test.inventory.infrastructure.persistence.entities.ItemJpa;
import com.test.inventory.infrastructure.persistence.mappers.ItemJpaMapper;
import com.test.inventory.infrastructure.persistence.repositories.ItemJpaRepository;
import java.util.List;
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
    public Optional<Item> findById(UUID id) {
        return jpaRepository.findById(id).map(mapper::toDomain);
    }

    @Override
    @Transactional
    public Item save(Item item) {
        return mapper.toDomain(jpaRepository.save(mapper.toJpa(item)));
    }

    @Override
    @Transactional
    public List<Item> saveAll(List<Item> entities) {
        return jpaRepository
            .saveAll(entities.stream().map(mapper::toJpa).toList())
            .stream()
            .map(mapper::toDomain)
            .toList();
    }

    @Override
    public List<Item> findAllById(List<UUID> ids) {
        return jpaRepository.findAllById(ids).stream().map(mapper::toDomain).toList();
    }

    @Override
    public long count() {
        return jpaRepository.count();
    }
}
