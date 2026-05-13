package com.test.ordering.domain.errors;

import com.test.shared.domain.customExceptions.NotFoundException;

/**
 * Order not found.
 */
// derived_from: errors[ORDER_NOT_FOUND]
public class OrderNotFoundError extends NotFoundException {

    public OrderNotFoundError() {
        super("ORDER_NOT_FOUND");
    }
}
