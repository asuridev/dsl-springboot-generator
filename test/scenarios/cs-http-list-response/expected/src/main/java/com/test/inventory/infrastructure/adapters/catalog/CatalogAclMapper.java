package com.test.inventory.infrastructure.adapters.catalog;

import com.test.inventory.domain.models.catalog.AvailableProduct;
import com.test.inventory.infrastructure.adapters.catalog.dtos.AvailableProductDto;
import org.springframework.stereotype.Component;

/**
 * ACL (Anti-Corruption Layer) mapper for {@link CatalogServicePort}.
 *
 * <p>Translates infrastructure DTOs (shaped by the catalog external API) into
 * domain models. If the external API changes, only these methods need updating;
 * domain logic using the domain models remains untouched.
 */
@Component
public class CatalogAclMapper {

    public AvailableProduct toAvailableProduct(AvailableProductDto dto) {
        if (dto == null) return null;
        return new AvailableProduct(dto.productId(), dto.name(), dto.unitPrice());
    }
}
