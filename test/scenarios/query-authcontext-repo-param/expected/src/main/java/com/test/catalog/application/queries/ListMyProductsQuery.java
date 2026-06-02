package com.test.catalog.application.queries;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.catalog.domain.enums.ProductStatus;
import com.test.shared.application.dtos.PagedResponse;
import com.test.shared.domain.interfaces.Query;

// derived_from: useCases[UC-CAT-001]
public record ListMyProductsQuery(
    ProductStatus status,
    int page,
    int size,
    String sortBy,
    String sortDirection
) implements Query<PagedResponse<ProductResponseDto>> {}
