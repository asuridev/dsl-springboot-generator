package com.test.catalog.infrastructure.persistence.mappers;

import com.test.catalog.domain.aggregate.Category;
import com.test.catalog.infrastructure.persistence.entities.CategoryJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * CategoryJpaMapper — stateless converter between the domain model
 * and its JPA representation.
 *
 * Extracted from CategoryRepositoryImpl to keep the adapter focused
 * on persistence orchestration. All conversions are pure functions; introduce
 * dependencies (e.g. value-object factories) only if a domain rule explicitly
 * requires them.
 */
@Component
public class CategoryJpaMapper {

    // ─── JPA → Domain ────────────────────────────────────────────────────────

    public Category toDomain(CategoryJpa jpa) {
        return new Category(jpa.getId(), jpa.getName(), jpa.getStatus());
    }

    // ─── Domain → JPA ────────────────────────────────────────────────────────

    public CategoryJpa toJpa(Category domain) {
        CategoryJpa jpa = CategoryJpa.builder()
            .id(domain.getId())
            .name(domain.getName())
            .status(domain.getStatus())
            .build();
        return jpa;
    }
}
