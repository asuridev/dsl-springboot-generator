package com.test.catalog.infrastructure.adapters.searchService;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

/**
 * Feign client for the search-service BC internal API.
 * Returns infrastructure DTOs — never domain models directly.
 * Mapped to domain models by {@link SearchServiceAclMapper}.
 */
@FeignClient(
    name = "search-service-client",
    url = "${integration.search-service.base-url}",
    configuration = SearchServiceRestConfig.class
)
public interface SearchServiceRestClient {
    @GetMapping("/v1/products/search")
    void searchProducts(
        @RequestParam("query") String query,
        @RequestParam("page") Integer page,
        @RequestParam("pageSize") Integer pageSize
    );
}
