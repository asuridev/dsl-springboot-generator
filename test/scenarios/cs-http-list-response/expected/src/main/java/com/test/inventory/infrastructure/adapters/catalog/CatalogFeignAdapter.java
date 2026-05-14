package com.test.inventory.infrastructure.adapters.catalog;

import com.test.inventory.application.ports.CatalogServicePort;
import com.test.inventory.domain.models.catalog.AvailableProduct;
import java.util.List;
import java.util.stream.Collectors;
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
    public List<AvailableProduct> listAvailableProducts() {
        return feignClient
            .listAvailableProducts()
            .stream()
            .map(aclMapper::toAvailableProduct)
            .collect(Collectors.toList());
    }
}
