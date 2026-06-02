package com.test.catalog.infrastructure.persistence.specs;

import com.test.catalog.infrastructure.persistence.entities.ProductJpa;
import org.springframework.data.jpa.domain.Specification;

/**
 * [G8] JPA Specification builders for Product filters.
 *
 * Each builder returns a {@link Specification} that can be combined via
 * {@code Specification.and(...)} / {@code Specification.or(...)} to compose
 * the final query passed to a {@code JpaSpecificationExecutor} repository.
 *
 * derived_from: useCases[UC-CAT-010]
 */
public final class ProductSpecs {

    private ProductSpecs() {
        // utility class — no instances
    }

    /**
     * Case-insensitive substring search across name, description, sku.
     * derived_from: useCases input "searchText"
     */
    public static Specification<ProductJpa> bySearchText(String text) {
        return (root, query, cb) -> {
            if (text == null || text.isBlank()) {
                return cb.conjunction();
            }
            String like = "%" + text.toLowerCase() + "%";
            return cb.or(
                cb.like(cb.lower(root.get("name")), like),
                cb.like(cb.lower(root.get("description")), like),
                cb.like(cb.lower(root.get("sku")), like)
            );
        };
    }
}
