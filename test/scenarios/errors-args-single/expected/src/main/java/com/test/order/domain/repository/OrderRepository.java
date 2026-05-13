package com.test.order.domain.repository;

import com.test.order.domain.aggregate.Order;
import java.util.Optional;
import java.util.UUID;

/**
 * OrderRepository — Domain repository port (output port).
 * Defines the persistence contract for the Order aggregate.
 * Implementations live in the infrastructure layer.
 */
public interface OrderRepository {
    Optional<Order> findByReference(String reference);

    Order save(Order order);

    Optional<Order> findById(UUID id);
}
