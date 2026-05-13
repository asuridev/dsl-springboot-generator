package com.test.warehouse.infrastructure.persistence.mappers;

import com.test.warehouse.domain.aggregate.Stock;
import com.test.warehouse.infrastructure.persistence.entities.StockJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * StockJpaMapper — stateless converter between the domain model
 * and its JPA representation.
 *
 * Extracted from StockRepositoryImpl to keep the adapter focused
 * on persistence orchestration. All conversions are pure functions; introduce
 * dependencies (e.g. value-object factories) only if a domain rule explicitly
 * requires them.
 */
@Component
public class StockJpaMapper {

    // ─── JPA → Domain ────────────────────────────────────────────────────────

    public Stock toDomain(StockJpa jpa) {
        return new Stock(jpa.getId(), jpa.getSku(), jpa.getQuantity());
    }

    // ─── Domain → JPA ────────────────────────────────────────────────────────

    public StockJpa toJpa(Stock domain) {
        StockJpa jpa = StockJpa.builder()
            .id(domain.getId())
            .sku(domain.getSku())
            .quantity(domain.getQuantity())
            .build();
        return jpa;
    }
}
