package com.test.orders.application.ports;

import com.test.orders.domain.models.catalog.ProductDetails;
import com.test.orders.domain.models.catalog.ValidateProductsResult;
import com.test.orders.infrastructure.adapters.catalog.dtos.ValidateProductsRequestDto;
import java.util.UUID;

/**
 * Output port — anti-corruption boundary to the catalog bounded context.
 * Implementations live in infrastructure/adapters/catalog/.
 *
 * <p>This interface is the single dependency point for all catalog interactions:
 * business operations (from catalog-internal-api.yaml) and FK validations.
 */
public interface CatalogServicePort {
    /**
     * Validate a product and its price.
     */
    ValidateProductsResult validateProductsAndPrices(ValidateProductsRequestDto body);

    /**
     * Retrieve a product by its ID.
     */
    ProductDetails getProductById(String productId);
}
