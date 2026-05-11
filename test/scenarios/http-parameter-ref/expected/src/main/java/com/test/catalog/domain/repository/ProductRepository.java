package com.test.catalog.domain.repository;

import com.test.catalog.domain.aggregate.Product;
import java.util.UUID;

/**
 * ProductRepository — Domain repository port (output port).
 * Defines the persistence contract for the Product aggregate.
 * Implementations live in the infrastructure layer.
 */
public interface ProductRepository {
    Product findById(UUID id);
}
