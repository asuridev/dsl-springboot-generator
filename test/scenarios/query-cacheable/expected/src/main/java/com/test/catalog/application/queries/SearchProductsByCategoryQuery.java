package com.test.catalog.application.queries;

import com.test.catalog.application.dtos.ProductPage;
import com.test.shared.domain.interfaces.Query;

// derived_from: useCases[UC-CAT-030]
public record SearchProductsByCategoryQuery(String categoryId, int page, int size) implements Query<ProductPage> {}
