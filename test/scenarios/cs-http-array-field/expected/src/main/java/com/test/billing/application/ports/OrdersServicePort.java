package com.test.billing.application.ports;

import com.test.billing.domain.models.orders.OrderDetailsResult;

/**
 * Output port — anti-corruption boundary to the orders bounded context.
 * Implementations live in infrastructure/adapters/orders/.
 *
 * <p>This interface is the single dependency point for all orders interactions:
 * business operations (from orders-internal-api.yaml) and FK validations.
 */
public interface OrdersServicePort {
    /**
     * Get order details including all line items.
     */
    OrderDetailsResult getOrderDetails(String orderId);
}
