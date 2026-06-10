package com.test.catalog.domain.errors;

import com.test.shared.domain.customExceptions.ConflictException;

/**
 * Category still has active products and cannot be archived.
 */
// derived_from: errors[CATEGORY_HAS_ACTIVE_PRODUCTS]
public class CategoryHasActiveProductsError extends ConflictException {

    public CategoryHasActiveProductsError() {
        super("CATEGORY_HAS_ACTIVE_PRODUCTS");
    }
}
