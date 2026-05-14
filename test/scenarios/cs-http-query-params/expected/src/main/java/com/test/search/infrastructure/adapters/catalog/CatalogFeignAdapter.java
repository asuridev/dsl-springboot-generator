package com.test.search.infrastructure.adapters.catalog;

import com.test.search.application.ports.CatalogServicePort;
import com.test.search.domain.models.catalog.ProductSearchResult;
import org.springframework.stereotype.Component;

/**
 * Feign adapter — infrastructure implementation of {@link CatalogServicePort}.
 * Delegates HTTP calls to {@link CatalogFeignClient} and maps
 * infrastructure DTOs to domain models via {@link CatalogAclMapper}.
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
    public ProductSearchResult searchProducts(String categoryId, boolean available) {
        return aclMapper.toProductSearchResult(feignClient.searchProducts(categoryId, available));
    }
}
