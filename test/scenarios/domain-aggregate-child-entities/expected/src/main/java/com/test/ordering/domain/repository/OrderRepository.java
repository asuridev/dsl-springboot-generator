package com.test.ordering.domain.repository;

import com.test.ordering.domain.aggregate.Order;
import java.util.Optional;
import java.util.UUID;

/**
 * OrderRepository — Domain repository port (output port).
 * Defines the persistence contract for the Order aggregate.
 * Implementations live in the infrastructure layer.
 */
public interface OrderRepository {
    Optional<Order> findById(UUID id);

    Order save(Order order);
}
