package com.test.orders.infrastructure.adapters.catalog;

import com.test.orders.infrastructure.adapters.catalog.dtos.ProductDetailsDto;
import com.test.orders.infrastructure.adapters.catalog.dtos.ValidateProductsRequestDto;
import com.test.orders.infrastructure.adapters.catalog.dtos.ValidateProductsResultDto;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

/**
 * Feign client for the catalog BC internal API.
 * Returns infrastructure DTOs — never domain models directly.
 * Mapped to domain models by {@link CatalogAclMapper}.
 */
@FeignClient(
    name = "orders-catalog-service",
    url = "${integration.catalog.base-url}",
    configuration = CatalogFeignConfig.class
)
public interface CatalogFeignClient {
    @PostMapping("/internal/products/validate")
    ValidateProductsResultDto validateProductsAndPrices(@RequestBody ValidateProductsRequestDto body);

    @GetMapping("/internal/products/{productId}")
    ProductDetailsDto getProductById(@PathVariable("productId") String productId);
}
