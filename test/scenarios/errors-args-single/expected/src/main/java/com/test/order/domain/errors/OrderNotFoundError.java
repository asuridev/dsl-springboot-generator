package com.test.order.domain.errors;

import com.test.shared.domain.customExceptions.NotFoundException;
import java.util.UUID;

/**
 * Order not found by its identifier.
 */
// derived_from: errors[ORDER_NOT_FOUND]
public class OrderNotFoundError extends NotFoundException {

    public OrderNotFoundError(UUID orderId) {
        super("Order " + String.valueOf(orderId) + " not found.", "ORDER_NOT_FOUND", 404, new Object[] { orderId });
    }
}
