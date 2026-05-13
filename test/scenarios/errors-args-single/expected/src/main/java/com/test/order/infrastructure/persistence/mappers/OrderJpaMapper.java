package com.test.order.infrastructure.persistence.mappers;

import com.test.order.domain.aggregate.Order;
import com.test.order.infrastructure.persistence.entities.OrderJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * OrderJpaMapper — stateless converter between the domain model
 * and its JPA representation.
 *
 * Extracted from OrderRepositoryImpl to keep the adapter focused
 * on persistence orchestration. All conversions are pure functions; introduce
 * dependencies (e.g. value-object factories) only if a domain rule explicitly
 * requires them.
 */
@Component
public class OrderJpaMapper {

    // ─── JPA → Domain ────────────────────────────────────────────────────────

    public Order toDomain(OrderJpa jpa) {
        return new Order(jpa.getId(), jpa.getReference());
    }

    // ─── Domain → JPA ────────────────────────────────────────────────────────

    public OrderJpa toJpa(Order domain) {
        OrderJpa jpa = OrderJpa.builder().id(domain.getId()).reference(domain.getReference()).build();
        return jpa;
    }
}
