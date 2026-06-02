package com.test.catalog.application.queries;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.shared.application.dtos.PagedResponse;
import com.test.shared.application.dtos.Range;
import com.test.shared.domain.interfaces.Query;
import java.math.BigDecimal;

// derived_from: useCases[UC-CAT-010]
public record SearchProductsByPriceRangeQuery(
    Range<BigDecimal> priceRange,
    int page,
    int size,
    String sortBy,
    String sortDirection
) implements Query<PagedResponse<ProductResponseDto>> {}
