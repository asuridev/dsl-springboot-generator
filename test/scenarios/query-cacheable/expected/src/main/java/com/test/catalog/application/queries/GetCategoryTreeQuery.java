package com.test.catalog.application.queries;

import com.test.catalog.application.dtos.CategoryTree;
import com.test.shared.domain.interfaces.Query;

// derived_from: useCases[UC-CAT-020]
public record GetCategoryTreeQuery() implements Query<CategoryTree> {}
