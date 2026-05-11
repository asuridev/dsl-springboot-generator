package com.test.products.domain.errors;

import com.test.shared.domain.customExceptions.NotFoundException;

// derived_from: errors[PRODUCT_NOT_FOUND]
public class ProductNotFoundError extends NotFoundException {

    public ProductNotFoundError() {
        super("PRODUCT_NOT_FOUND");
    }
}
