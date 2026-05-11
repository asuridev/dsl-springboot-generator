package com.test.catalog.application.queries;

import com.test.catalog.application.dtos.ProductResponseDto;
import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.NotBlank;

// derived_from: useCases[get-product-by-id]
public record GetProductByIdQuery(@NotBlank String productId) implements Query<ProductResponseDto> {}
