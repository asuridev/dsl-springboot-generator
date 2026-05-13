package com.test.orders.application.ports;

import com.test.orders.infrastructure.adapters.catalog.dtos.ValidateProductRequestDto;

/**
 * Output port — anti-corruption boundary to the catalog bounded context.
 * Implementations live in infrastructure/adapters/catalog/.
 *
 * <p>This interface is the single dependency point for all catalog interactions:
 * business operations (from catalog-internal-api.yaml) and FK validations.
 */
public interface CatalogServicePort {
    /**
     * Validate a product.
     */
    void validateProduct(ValidateProductRequestDto body);
}
