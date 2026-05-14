package com.test.search.infrastructure.adapters.catalog;

import com.test.search.domain.models.catalog.ProductSearchResult;
import com.test.search.infrastructure.adapters.catalog.dtos.ProductSearchResultDto;
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

    public ProductSearchResult toProductSearchResult(ProductSearchResultDto dto) {
        if (dto == null) return null;
        return new ProductSearchResult(dto.totalCount(), dto.page());
    }
}
