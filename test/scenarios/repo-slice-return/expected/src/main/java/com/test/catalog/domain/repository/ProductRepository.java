package com.test.catalog.domain.repository;

import com.test.catalog.domain.aggregate.Product;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Slice;

/**
 * ProductRepository — Domain repository port (output port).
 * Defines the persistence contract for the Product aggregate.
 * Implementations live in the infrastructure layer.
 */
public interface ProductRepository {
    Slice<Product> browseProducts(String name);

    Optional<Product> findById(UUID id);

    Product save(Product product);
}
