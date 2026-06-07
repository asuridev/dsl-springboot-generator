package com.test.search.infrastructure.adapters.catalog;

import com.test.search.infrastructure.adapters.catalog.dtos.ProductSearchResultDto;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

/**
 * Feign client for the catalog BC internal API.
 * Returns infrastructure DTOs — never domain models directly.
 * Mapped to domain models by {@link CatalogAclMapper}.
 */
@FeignClient(
    name = "search-catalog-service",
    url = "${integration.catalog.base-url}",
    configuration = CatalogFeignConfig.class
)
public interface CatalogFeignClient {
    @GetMapping("/internal/products/search")
    ProductSearchResultDto searchProducts(
        @RequestParam("categoryId") String categoryId,
        @RequestParam("available") boolean available
    );
}
