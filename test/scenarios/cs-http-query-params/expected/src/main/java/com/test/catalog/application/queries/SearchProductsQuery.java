package com.test.catalog.application.queries;

import com.test.catalog.application.dtos.ProductSearchResultDto;
import com.test.shared.domain.interfaces.Query;

// derived_from: useCases[search-products]
public record SearchProductsQuery() implements Query<ProductSearchResultDto> {}
