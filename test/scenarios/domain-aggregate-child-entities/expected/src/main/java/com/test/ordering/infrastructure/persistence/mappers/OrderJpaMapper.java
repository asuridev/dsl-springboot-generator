package com.test.ordering.infrastructure.persistence.mappers;

import com.test.ordering.domain.aggregate.Order;
import com.test.ordering.domain.entity.OrderLine;
import com.test.ordering.infrastructure.persistence.entities.OrderJpa;
import com.test.ordering.infrastructure.persistence.entities.OrderLineJpa;
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
        return new Order(
            jpa.getId(),
            jpa.getCustomerId(),
            jpa.getOrderLines().stream().map(this::toOrderLineDomain).toList(),
            jpa.getCreatedAt(),
            jpa.getUpdatedAt()
        );
    }

    public OrderLine toOrderLineDomain(OrderLineJpa jpa) {
        return new OrderLine(jpa.getId(), jpa.getProductId(), jpa.getQuantity(), jpa.getTags());
    }

    // ─── Domain → JPA ────────────────────────────────────────────────────────

    public OrderJpa toJpa(Order domain) {
        OrderJpa jpa = OrderJpa.builder()
            .id(domain.getId())
            .customerId(domain.getCustomerId())
            .orderLines(
                domain
                    .getOrderLines()
                    .stream()
                    .map(this::toOrderLineJpa)
                    .collect(java.util.stream.Collectors.toCollection(java.util.ArrayList::new))
            )
            .build();
        return jpa;
    }

    public OrderLineJpa toOrderLineJpa(OrderLine domain) {
        return OrderLineJpa.builder()
            .id(domain.getId())
            .productId(domain.getProductId())
            .quantity(domain.getQuantity())
            .tags(domain.getTags())
            .build();
    }
}
