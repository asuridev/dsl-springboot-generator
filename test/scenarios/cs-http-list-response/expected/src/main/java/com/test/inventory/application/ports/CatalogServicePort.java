package com.test.inventory.application.ports;

import com.test.inventory.domain.models.catalog.AvailableProduct;
import java.util.List;

/**
 * Output port — anti-corruption boundary to the catalog bounded context.
 * Implementations live in infrastructure/adapters/catalog/.
 *
 * <p>This interface is the single dependency point for all catalog interactions:
 * business operations (from catalog-internal-api.yaml) and FK validations.
 */
public interface CatalogServicePort {
    /**
     * List all available products.
     */
    List<AvailableProduct> listAvailableProducts();
}
