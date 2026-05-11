package com.test.orders.infrastructure.adapters.catalog;

import com.test.orders.application.ports.CatalogServicePort;
import com.test.orders.infrastructure.adapters.catalog.dtos.ValidateProductRequestDto;
import java.util.UUID;
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
    public void validateProduct(ValidateProductRequestDto body) {
        feignClient.validateProduct(body);
    }
}
