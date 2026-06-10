package com.test.catalog.domain.errors;

import com.test.shared.domain.customExceptions.NotFoundException;

/**
 * Category not found.
 */
// derived_from: errors[CATEGORY_NOT_FOUND]
public class CategoryNotFoundError extends NotFoundException {

    public CategoryNotFoundError() {
        super("CATEGORY_NOT_FOUND");
    }
}
