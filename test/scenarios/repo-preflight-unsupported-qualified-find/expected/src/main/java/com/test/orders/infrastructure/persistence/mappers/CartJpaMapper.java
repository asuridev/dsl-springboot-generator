package com.test.orders.infrastructure.persistence.mappers;

import com.test.orders.domain.aggregate.Cart;
import com.test.orders.infrastructure.persistence.entities.CartJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * CartJpaMapper — stateless converter between the domain model
 * and its JPA representation.
 *
 * Extracted from CartRepositoryImpl to keep the adapter focused
 * on persistence orchestration. All conversions are pure functions; introduce
 * dependencies (e.g. value-object factories) only if a domain rule explicitly
 * requires them.
 */
@Component
public class CartJpaMapper {

    // ─── JPA → Domain ────────────────────────────────────────────────────────

    public Cart toDomain(CartJpa jpa) {
        return new Cart(jpa.getId(), jpa.getCustomerId(), jpa.getStatus());
    }

    // ─── Domain → JPA ────────────────────────────────────────────────────────

    public CartJpa toJpa(Cart domain) {
        CartJpa jpa = CartJpa.builder()
            .id(domain.getId())
            .customerId(domain.getCustomerId())
            .status(domain.getStatus())
            .build();
        return jpa;
    }
}
