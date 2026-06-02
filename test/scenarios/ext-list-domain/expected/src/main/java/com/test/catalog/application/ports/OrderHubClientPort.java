package com.test.catalog.application.ports;

import com.test.catalog.domain.models.orderHub.OrderSummary;

/**
 * Output port — anti-corruption boundary to the order-hub bounded context.
 * Implementations live in infrastructure/adapters/orderHub/.
 *
 * <p>This interface is the single dependency point for all order-hub interactions:
 * business operations (from order-hub-internal-api.yaml) and FK validations.
 */
public interface OrderHubClientPort {
    /**
     * Retrieve a lightweight order summary by ID.
     */
    OrderSummary getOrderSummary(String orderId);
}
