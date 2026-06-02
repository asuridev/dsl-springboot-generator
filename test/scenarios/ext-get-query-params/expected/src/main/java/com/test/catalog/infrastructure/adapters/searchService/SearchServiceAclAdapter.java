package com.test.catalog.infrastructure.adapters.searchService;

import com.test.catalog.application.ports.SearchServiceClientPort;
import org.springframework.stereotype.Component;

/**
 * Feign adapter — infrastructure implementation of {@link SearchServiceClientPort}.
 * Delegates HTTP calls to {@link SearchServiceRestClient} and maps
 * infrastructure DTOs to domain models via {@link SearchServiceAclMapper}.
 */
@Component
public class SearchServiceAclAdapter implements SearchServiceClientPort {

    private final SearchServiceRestClient feignClient;
    private final SearchServiceAclMapper aclMapper;

    public SearchServiceAclAdapter(SearchServiceRestClient feignClient, SearchServiceAclMapper aclMapper) {
        this.feignClient = feignClient;
        this.aclMapper = aclMapper;
    }

    @Override
    public void searchProducts(String query, Integer page, Integer pageSize) {
        feignClient.searchProducts(query, page, pageSize);
    }
}
