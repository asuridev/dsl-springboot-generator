package com.test.catalog.infrastructure.persistence.mappers;

import com.test.catalog.domain.aggregate.Tag;
import com.test.catalog.infrastructure.persistence.entities.TagJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * TagJpaMapper — stateless converter between the domain model
 * and its JPA representation.
 *
 * Extracted from TagRepositoryImpl to keep the adapter focused
 * on persistence orchestration. All conversions are pure functions; introduce
 * dependencies (e.g. value-object factories) only if a domain rule explicitly
 * requires them.
 */
@Component
public class TagJpaMapper {

    // ─── JPA → Domain ────────────────────────────────────────────────────────

    public Tag toDomain(TagJpa jpa) {
        return new Tag(jpa.getId(), jpa.getCreatedAt(), jpa.getUpdatedAt());
    }

    // ─── Domain → JPA ────────────────────────────────────────────────────────

    public TagJpa toJpa(Tag domain) {
        TagJpa jpa = TagJpa.builder().id(domain.getId()).build();
        return jpa;
    }
}
