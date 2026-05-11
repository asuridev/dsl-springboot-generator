package com.test.catalog.application.queries;

import com.test.catalog.application.dtos.ProductDetail;
import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.NotBlank;

// derived_from: useCases[UC-CAT-010]
public record GetProductByIdQuery(@NotBlank String productId) implements Query<ProductDetail> {}
