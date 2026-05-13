package com.test.catalog.infrastructure.persistence.repositories;

import com.test.catalog.domain.aggregate.Tag;
import com.test.catalog.domain.repository.TagRepository;
import com.test.catalog.infrastructure.persistence.entities.TagJpa;
import com.test.catalog.infrastructure.persistence.mappers.TagJpaMapper;
import com.test.catalog.infrastructure.persistence.repositories.TagJpaRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * TagRepositoryImpl — Infrastructure adapter implementing TagRepository.
 * Bridges the domain repository port with Spring Data JPA. Conversions between
 * the domain model and the JPA model live in TagJpaMapper so that
 * this adapter can stay focused on persistence orchestration and transactions.
 */
@Component
@Transactional(readOnly = true)
public class TagRepositoryImpl implements TagRepository {

    private final TagJpaRepository jpaRepository;
    private final TagJpaMapper mapper;

    public TagRepositoryImpl(TagJpaRepository jpaRepository, TagJpaMapper mapper) {
        this.jpaRepository = jpaRepository;
        this.mapper = mapper;
    }

    // ─── Repository methods ───────────────────────────────────────────────────

    @Override
    public Optional<Tag> findById(UUID id) {
        return jpaRepository.findById(id).map(mapper::toDomain);
    }

    @Override
    @Transactional
    public Tag save(Tag tag) {
        return mapper.toDomain(jpaRepository.save(mapper.toJpa(tag)));
    }
}
