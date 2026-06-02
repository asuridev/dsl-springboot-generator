package com.test.catalog.application.queries;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.Size;
import java.util.List;

// derived_from: useCases[UC-CAT-001]
public record BrowseProductsQuery(@Size(max = 200) String name) implements Query<List<ProductResponseDto>> {}
