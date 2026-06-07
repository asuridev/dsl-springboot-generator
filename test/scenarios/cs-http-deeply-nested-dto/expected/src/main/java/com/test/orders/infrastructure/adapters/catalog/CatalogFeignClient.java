package com.test.orders.infrastructure.adapters.catalog;

import com.test.orders.infrastructure.adapters.catalog.dtos.ProductPriceValidationRequestDto;
import com.test.orders.infrastructure.adapters.catalog.dtos.ProductPriceValidationResultDto;
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
    @PostMapping("/internal/catalog/prices/validate")
    ProductPriceValidationResultDto validateProductPrices(@RequestBody ProductPriceValidationRequestDto body);
}
