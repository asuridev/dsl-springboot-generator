package com.test.catalog.domain.errors;

import com.test.shared.domain.customExceptions.NotFoundException;

// derived_from: errors[PRODUCT_NOT_FOUND]
public class ProductNotFoundError extends NotFoundException {

    public ProductNotFoundError() {
        super("PRODUCT_NOT_FOUND");
    }
}
