package com.test.orders.application.ports;

import com.test.orders.domain.models.catalog.OrderSummaryResult;

/**
 * Output port — anti-corruption boundary to the catalog bounded context.
 * Implementations live in infrastructure/adapters/catalog/.
 *
 * <p>This interface is the single dependency point for all catalog interactions:
 * business operations (from catalog-internal-api.yaml) and FK validations.
 */
public interface CatalogServicePort {
    /**
     * Get a summary of an order including customer info.
     */
    OrderSummaryResult getOrderSummary(String orderId);
}
