package com.test.orders.application.ports;

import com.test.orders.domain.models.catalog.ProductPriceValidationResult;
import com.test.orders.infrastructure.adapters.catalog.dtos.ProductPriceValidationRequestDto;

/**
 * Output port — anti-corruption boundary to the catalog bounded context.
 * Implementations live in infrastructure/adapters/catalog/.
 *
 * <p>This interface is the single dependency point for all catalog interactions:
 * business operations (from catalog-internal-api.yaml) and FK validations.
 */
public interface CatalogServicePort {
    /**
     * Validate prices for a list of products and return per-item results.
     */
    ProductPriceValidationResult validateProductPrices(ProductPriceValidationRequestDto body);
}
