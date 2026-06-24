package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

// derived_from: useCases[UC-CAT-002]
public record UpdateProductPriceCommand(String productId, @NotNull @Valid MoneyRequest price) implements Command {}
