package com.test.orders.infrastructure.adapters.catalog;

import com.test.orders.domain.models.catalog.ProductPriceValidationItem;
import com.test.orders.domain.models.catalog.ProductPriceValidationResult;
import com.test.orders.domain.valueobject.Money;
import com.test.orders.infrastructure.adapters.catalog.dtos.ProductPriceValidationItemDto;
import com.test.orders.infrastructure.adapters.catalog.dtos.ProductPriceValidationResultDto;
import java.math.BigDecimal;
import java.util.List;
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

    public ProductPriceValidationResult toProductPriceValidationResult(ProductPriceValidationResultDto dto) {
        if (dto == null) return null;
        return new ProductPriceValidationResult(
            dto.valid(),
            dto.items() == null
                ? null
                : dto
                      .items()
                      .stream()
                      .map(this::mapToProductPriceValidationItem)
                      .collect(java.util.stream.Collectors.toList())
        );
    }

    private ProductPriceValidationItem mapToProductPriceValidationItem(ProductPriceValidationItemDto dto) {
        if (dto == null) return null;
        return new ProductPriceValidationItem(
            dto.productId(),
            dto.available(),
            new Money(new java.math.BigDecimal(dto.unitPrice().amount()), dto.unitPrice().currency())
        );
    }
}
