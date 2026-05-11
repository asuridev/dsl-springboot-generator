package com.test.orders.infrastructure.adapters.catalog;

import com.test.orders.infrastructure.adapters.catalog.dtos.ValidateProductRequestDto;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

/**
 * Feign client for the catalog BC internal API.
 * Returns infrastructure DTOs — never domain models directly.
 * Mapped to domain models by {@link CatalogAclMapper}.
 */
@FeignClient(
    name = "catalog-service",
    url = "${integration.catalog.base-url}",
    configuration = CatalogFeignConfig.class
)
public interface CatalogFeignClient {
    @PostMapping("/internal/products/validate")
    void validateProduct(@RequestBody ValidateProductRequestDto body);
}
