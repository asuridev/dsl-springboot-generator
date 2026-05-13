package com.test.order.domain.errors;

import com.test.shared.domain.customExceptions.NotFoundException;

/**
 * Order not found by reference number.
 */
// derived_from: errors[ORDER_REF_NOT_FOUND]
public class OrderRefNotFoundError extends NotFoundException {

    public OrderRefNotFoundError(String reference) {
        super(
            "No order with reference '" + String.valueOf(reference) + "' exists.",
            "ORDER_REF_NOT_FOUND",
            404,
            new Object[] { reference }
        );
    }
}
