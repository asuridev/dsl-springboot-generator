package com.test.orders.infrastructure.adapters.catalog;

import com.test.orders.application.ports.CatalogServicePort;
import com.test.orders.domain.models.catalog.ProductDetails;
import com.test.orders.domain.models.catalog.ValidateProductsResult;
import com.test.orders.infrastructure.adapters.catalog.dtos.ValidateProductsRequestDto;
import io.github.resilience4j.circuitbreaker.annotation.CircuitBreaker;
import io.github.resilience4j.retry.annotation.Retry;
import org.springframework.stereotype.Component;

/**
 * Feign adapter — infrastructure implementation of {@link CatalogServicePort}.
 * Delegates HTTP calls to {@link CatalogFeignClient} and maps
 * infrastructure DTOs to domain models via {@link CatalogAclMapper}.
 *
 * derived_from: system.yaml#/integrations[from=orders,to=catalog]/resilience
 */
@Component
public class CatalogFeignAdapter implements CatalogServicePort {

    private final CatalogFeignClient feignClient;
    private final CatalogAclMapper aclMapper;

    public CatalogFeignAdapter(CatalogFeignClient feignClient, CatalogAclMapper aclMapper) {
        this.feignClient = feignClient;
        this.aclMapper = aclMapper;
    }

    @Override
    @CircuitBreaker(name = "catalog", fallbackMethod = "validateProductsAndPricesFallback")
    @Retry(name = "catalog")
    public ValidateProductsResult validateProductsAndPrices(ValidateProductsRequestDto body) {
        return aclMapper.toValidateProductsResult(feignClient.validateProductsAndPrices(body));
    }

    /**
     * Resilience fallback for {@link #validateProductsAndPrices}.
     * Invoked when the circuit-breaker is open or after retries are exhausted.
     */
    @SuppressWarnings("unused")
    private ValidateProductsResult validateProductsAndPricesFallback(ValidateProductsRequestDto body, Throwable cause) {
        // TODO: implement fallback for validateProductsAndPrices — derived_from: resilience.fallback
        throw new UnsupportedOperationException("Fallback for validateProductsAndPrices not implemented yet", cause);
    }

    @Override
    @CircuitBreaker(name = "catalog", fallbackMethod = "getProductByIdFallback")
    @Retry(name = "catalog")
    public ProductDetails getProductById(String productId) {
        return aclMapper.toProductDetails(feignClient.getProductById(productId));
    }

    /**
     * Resilience fallback for {@link #getProductById}.
     * Invoked when the circuit-breaker is open or after retries are exhausted.
     */
    @SuppressWarnings("unused")
    private ProductDetails getProductByIdFallback(String productId, Throwable cause) {
        // TODO: implement fallback for getProductById — derived_from: resilience.fallback
        throw new UnsupportedOperationException("Fallback for getProductById not implemented yet", cause);
    }
}
