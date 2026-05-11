package com.test.products.application.queries;

import com.test.products.application.dtos.ProductDetail;
import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.NotBlank;

// derived_from: useCases[UC-PRD-010]
public record GetProductByIdQuery(@NotBlank String productId) implements Query<ProductDetail> {}
