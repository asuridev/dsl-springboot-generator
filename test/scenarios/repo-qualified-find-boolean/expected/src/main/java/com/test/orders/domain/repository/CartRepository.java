package com.test.orders.domain.repository;

import com.test.orders.domain.aggregate.Cart;
import java.util.Optional;
import java.util.UUID;

/**
 * CartRepository — Domain repository port (output port).
 * Defines the persistence contract for the Cart aggregate.
 * Implementations live in the infrastructure layer.
 */
public interface CartRepository {
    Optional<Cart> findDefaultByCustomerId(UUID customerId);

    Optional<Cart> findNonDefaultByCustomerId(UUID customerId);

    long countDefaultByCustomerId(UUID customerId);

    boolean existsDefaultByCustomerId(UUID customerId);

    Optional<Cart> findById(UUID id);
}
