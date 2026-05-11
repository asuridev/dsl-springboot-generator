package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

// derived_from: useCases[validate-products-and-prices]
public record ValidateProductsAndPricesCommand(
    @NotBlank String productId,
    @NotNull Integer quantity
) implements Command {}
