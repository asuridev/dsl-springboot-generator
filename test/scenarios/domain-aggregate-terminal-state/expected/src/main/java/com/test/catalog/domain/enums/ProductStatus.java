package com.test.catalog.domain.enums;

import com.test.shared.domain.customExceptions.InvalidStateTransitionException;
import java.util.Map;
import java.util.Set;

/**
 * ProductStatus
 * Lifecycle states of a Product.
 */
public enum ProductStatus {
    DRAFT,
    ACTIVE,
    DISCONTINUED;

    private static final Map<ProductStatus, Set<ProductStatus>> VALID_TRANSITIONS = Map.ofEntries(
        Map.entry(ProductStatus.DRAFT, Set.of(ProductStatus.ACTIVE)),
        Map.entry(ProductStatus.ACTIVE, Set.of(ProductStatus.DISCONTINUED)),
        Map.entry(ProductStatus.DISCONTINUED, Set.of())
    );

    /**
     * Returns {@code true} if transitioning from the current state to {@code target} is allowed.
     */
    public boolean canTransitionTo(ProductStatus target) {
        return VALID_TRANSITIONS.getOrDefault(this, Set.of()).contains(target);
    }

    /**
     * Transitions to {@code target} state.
     *
     * @throws InvalidStateTransitionException if the transition is not permitted.
     */
    public ProductStatus transitionTo(ProductStatus target) {
        if (!canTransitionTo(target)) {
            throw new InvalidStateTransitionException(this.name(), target.name());
        }
        return target;
    }
}
