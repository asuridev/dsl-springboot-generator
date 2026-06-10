package com.test.catalog.infrastructure.persistence.repositories;

import com.test.catalog.domain.aggregate.Category;
import com.test.catalog.domain.repository.CategoryRepository;
import com.test.catalog.infrastructure.persistence.entities.CategoryJpa;
import com.test.catalog.infrastructure.persistence.mappers.CategoryJpaMapper;
import com.test.catalog.infrastructure.persistence.repositories.CategoryJpaRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * CategoryRepositoryImpl — Infrastructure adapter implementing CategoryRepository.
 * Bridges the domain repository port with Spring Data JPA. Conversions between
 * the domain model and the JPA model live in CategoryJpaMapper so that
 * this adapter can stay focused on persistence orchestration and transactions.
 */
@Component
@Transactional(readOnly = true)
public class CategoryRepositoryImpl implements CategoryRepository {

    private final CategoryJpaRepository jpaRepository;
    private final CategoryJpaMapper mapper;

    public CategoryRepositoryImpl(CategoryJpaRepository jpaRepository, CategoryJpaMapper mapper) {
        this.jpaRepository = jpaRepository;
        this.mapper = mapper;
    }

    // ─── Repository methods ───────────────────────────────────────────────────

    @Override
    public Optional<Category> findById(UUID id) {
        return jpaRepository.findById(id).map(mapper::toDomain);
    }

    @Override
    @Transactional
    public Category save(Category category) {
        return mapper.toDomain(jpaRepository.save(mapper.toJpa(category)));
    }
}
