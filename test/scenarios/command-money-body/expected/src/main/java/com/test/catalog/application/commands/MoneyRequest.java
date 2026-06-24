package com.test.catalog.application.commands;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

public record MoneyRequest(@NotNull BigDecimal amount, @NotBlank @Size(max = 3) String currency) {}
