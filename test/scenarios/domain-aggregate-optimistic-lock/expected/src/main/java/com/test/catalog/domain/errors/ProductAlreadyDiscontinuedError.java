package com.test.catalog.domain.errors;

import com.test.shared.domain.customExceptions.ConflictException;

/**
 * Product is already in a terminal discontinued state.
 */
// derived_from: errors[PRODUCT_ALREADY_DISCONTINUED]
public class ProductAlreadyDiscontinuedError extends ConflictException {

    public ProductAlreadyDiscontinuedError() {
        super("PRODUCT_ALREADY_DISCONTINUED");
    }
}
