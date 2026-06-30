package com.test.catalog.application.queries;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.catalog.domain.enums.ProductStatus;
import com.test.shared.application.dtos.PagedResponse;
import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.Size;

// derived_from: useCases[UC-CAT-002]
public record AdminSearchProductsQuery(
    String categoryId,
    ProductStatus status,
    @Size(max = 200) String search,
    int page,
    int size,
    String sortBy,
    String sortDirection
) implements Query<PagedResponse<ProductResponseDto>> {}
