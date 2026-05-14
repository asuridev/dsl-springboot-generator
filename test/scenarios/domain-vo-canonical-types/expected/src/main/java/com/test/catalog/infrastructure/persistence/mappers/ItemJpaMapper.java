package com.test.catalog.infrastructure.persistence.mappers;

import com.test.catalog.domain.aggregate.Item;
import com.test.catalog.infrastructure.persistence.entities.ItemJpa;
import org.springframework.stereotype.Component;

/**
 * ItemJpaMapper — stateless converter between the domain model
 * and its JPA representation.
 *
 * Extracted from ItemRepositoryImpl to keep the adapter focused
 * on persistence orchestration. All conversions are pure functions; introduce
 * dependencies (e.g. value-object factories) only if a domain rule explicitly
 * requires them.
 */
@Component
public class ItemJpaMapper {

    // ─── JPA → Domain ────────────────────────────────────────────────────────

    public Item toDomain(ItemJpa jpa) {
        return new Item(jpa.getId());
    }

    // ─── Domain → JPA ────────────────────────────────────────────────────────

    public ItemJpa toJpa(Item domain) {
        ItemJpa jpa = ItemJpa.builder().id(domain.getId()).build();
        return jpa;
    }
}
