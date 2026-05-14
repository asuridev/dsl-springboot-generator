package com.test.catalog.application.queries;

import com.test.catalog.application.dtos.AvailableProductDto;
import com.test.shared.domain.interfaces.Query;
import java.util.List;

// derived_from: useCases[list-available-products]
public record ListAvailableProductsQuery() implements Query<AvailableProductDto> {}
