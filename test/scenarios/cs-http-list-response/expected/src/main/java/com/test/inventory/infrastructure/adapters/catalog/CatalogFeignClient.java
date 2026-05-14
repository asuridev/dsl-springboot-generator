package com.test.inventory.infrastructure.adapters.catalog;

import com.test.inventory.infrastructure.adapters.catalog.dtos.AvailableProductDto;
import java.util.List;
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
    @GetMapping("/internal/products/available")
    List<AvailableProductDto> listAvailableProducts();
}
