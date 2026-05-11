package com.test.item.application.commands;

import com.test.shared.domain.interfaces.ReturningCommand;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

// derived_from: useCases[calculate-item-price]
public record CalculateItemPriceCommand(
    @NotBlank String itemId,
    @NotNull Integer quantity
) implements ReturningCommand<BigDecimal> {}
