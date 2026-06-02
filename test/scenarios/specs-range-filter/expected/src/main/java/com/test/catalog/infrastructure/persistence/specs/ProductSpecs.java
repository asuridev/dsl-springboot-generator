package com.test.catalog.infrastructure.persistence.specs;

import com.test.catalog.infrastructure.persistence.entities.ProductJpa;
import com.test.shared.application.dtos.Range;
import java.math.BigDecimal;
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
     * Filters by inclusive range on the Product aggregate.
     * derived_from: useCases input "priceRange"
     */
    public static Specification<ProductJpa> byPriceRange(Range<BigDecimal> range) {
        return (root, query, cb) -> {
            if (range == null || (range.min() == null && range.max() == null)) {
                return cb.conjunction();
            }
            // TODO: map "priceRange" to the JPA attribute path on ProductJpa
            // (e.g. root.get("<field>") for primitives, root.get("<field>Amount") for Money VOs).
            // Build predicates from range.min() (cb.greaterThanOrEqualTo) and range.max()
            // (cb.lessThanOrEqualTo), skipping null bounds. Combine with cb.and(...).
            return cb.conjunction();
        };
    }
}
