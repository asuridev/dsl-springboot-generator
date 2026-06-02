package com.test.catalog.application.queries;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.catalog.domain.enums.Category;
import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.NotNull;
import java.util.List;

// derived_from: useCases[UC-CAT-001]
public record FindProductsByCategoryQuery(@NotNull Category category) implements Query<List<ProductResponseDto>> {}
