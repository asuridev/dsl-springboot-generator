package com.test.catalog.application.ports;

/**
 * Output port — anti-corruption boundary to the search-service bounded context.
 * Implementations live in infrastructure/adapters/searchService/.
 *
 * <p>This interface is the single dependency point for all search-service interactions:
 * business operations (from search-service-internal-api.yaml) and FK validations.
 */
public interface SearchServiceClientPort {
    /**
     * Search products by free-text query with pagination.
     */
    void searchProducts(String query, Integer page, Integer pageSize);
}
