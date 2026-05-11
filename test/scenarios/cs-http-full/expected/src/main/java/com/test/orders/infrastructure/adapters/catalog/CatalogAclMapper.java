package com.test.orders.infrastructure.adapters.catalog;

import com.test.orders.domain.models.catalog.ProductDetails;
import com.test.orders.domain.models.catalog.ValidateProductsResult;
import com.test.orders.infrastructure.adapters.catalog.dtos.ProductDetailsDto;
import com.test.orders.infrastructure.adapters.catalog.dtos.ValidateProductsResultDto;
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

    public ValidateProductsResult toValidateProductsResult(ValidateProductsResultDto dto) {
        if (dto == null) return null;
        return new ValidateProductsResult(dto.valid(), dto.unitPrice());
    }

    public ProductDetails toProductDetails(ProductDetailsDto dto) {
        if (dto == null) return null;
        return new ProductDetails(dto.productId(), dto.name(), dto.price());
    }
}
