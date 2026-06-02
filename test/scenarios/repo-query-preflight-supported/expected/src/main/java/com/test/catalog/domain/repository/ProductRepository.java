package com.test.catalog.domain.repository;

import com.test.catalog.domain.aggregate.Product;
import com.test.catalog.domain.enums.ProductStatus;
import java.util.List;
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
    // derived_from: openapi:searchProducts
    Page<Product> searchActive(UUID categoryId, String search, Pageable page);

    // derived_from: openapi:adminSearchProducts
    Page<Product> searchAll(UUID categoryId, ProductStatus status, String search, Pageable page);

    List<Product> findByProductIds(List<UUID> productIds);

    Optional<Product> findById(UUID id);

    // derived_from: RULE-CAT-003
    boolean existsActiveByCategoryId(UUID categoryId);

    // derived_from: RULE-CAT-003
    long countActiveByCategoryId(UUID categoryId);

    Product save(Product product);
}
