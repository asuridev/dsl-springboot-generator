package com.test.catalog.application.queries;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

/**
 * Returns products for a set of ids supplied as repeated query parameters (?productIds=a&productIds=b). The input is a List[Uuid] bound from the query string.
 *
 *
 * derived_from: useCases[UC-CAT-001]
 */
public record FindProductsByIdsQuery(@NotEmpty List<String> productIds) implements Query<List<ProductResponseDto>> {}
