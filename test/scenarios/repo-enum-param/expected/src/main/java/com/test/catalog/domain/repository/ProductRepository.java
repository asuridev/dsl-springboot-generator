package com.test.catalog.domain.repository;

import com.test.catalog.domain.aggregate.Product;
import com.test.catalog.domain.enums.Category;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * ProductRepository — Domain repository port (output port).
 * Defines the persistence contract for the Product aggregate.
 * Implementations live in the infrastructure layer.
 */
public interface ProductRepository {
    List<Product> findByCategory(Category category);

    Optional<Product> findById(UUID id);

    Product save(Product product);
}
