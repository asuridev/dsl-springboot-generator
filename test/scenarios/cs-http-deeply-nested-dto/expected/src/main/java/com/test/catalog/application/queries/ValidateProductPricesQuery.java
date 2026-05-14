package com.test.catalog.application.queries;

import com.test.catalog.application.dtos.ProductPriceValidationResultDto;
import com.test.shared.domain.interfaces.Query;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;

// derived_from: useCases[validate-product-prices]
public record ValidateProductPricesQuery(
    @Valid List<UUID> productIds
) implements Query<ProductPriceValidationResultDto> {}
