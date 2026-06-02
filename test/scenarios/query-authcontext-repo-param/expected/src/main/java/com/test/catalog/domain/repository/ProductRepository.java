package com.test.catalog.domain.repository;

import com.test.catalog.domain.aggregate.Product;
import com.test.catalog.domain.enums.ProductStatus;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

/**
 * ProductRepository — Domain repository port (output port).
 * Defines the persistence contract for the Product aggregate.
 * Implementations live in the infrastructure layer.
 */
public interface ProductRepository {
    // derived_from: openapi:listMyProducts
    Page<Product> list(UUID ownerId, ProductStatus status, Pageable page);

    Optional<Product> findById(UUID id);

    Product save(Product product);
}
