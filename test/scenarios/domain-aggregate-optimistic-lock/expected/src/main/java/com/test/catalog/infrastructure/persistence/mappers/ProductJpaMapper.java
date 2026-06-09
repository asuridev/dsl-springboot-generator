package com.test.catalog.infrastructure.persistence.mappers;

import com.test.catalog.domain.aggregate.Product;
import com.test.catalog.infrastructure.persistence.entities.ProductJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * ProductJpaMapper — stateless converter between the domain model
 * and its JPA representation.
 *
 * Extracted from ProductRepositoryImpl to keep the adapter focused
 * on persistence orchestration. All conversions are pure functions; introduce
 * dependencies (e.g. value-object factories) only if a domain rule explicitly
 * requires them.
 */
@Component
public class ProductJpaMapper {

    // ─── JPA → Domain ────────────────────────────────────────────────────────

    public Product toDomain(ProductJpa jpa) {
        return new Product(jpa.getId(), jpa.getName(), jpa.getStatus(), jpa.getVersion());
    }

    // ─── Domain → JPA ────────────────────────────────────────────────────────

    public ProductJpa toJpa(Product domain) {
        ProductJpa jpa = ProductJpa.builder()
            .id(domain.getId())
            .name(domain.getName())
            .status(domain.getStatus())
            .version(domain.getVersion())
            .build();
        return jpa;
    }
}
