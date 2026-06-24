package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.ReturningCommand;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

// derived_from: useCases[UC-CAT-001]
public record CreateProductCommand(
    @com.fasterxml.jackson.annotation.JsonIgnore UUID id,
    @NotBlank String name,
    @NotNull @Valid MoneyRequest price
) implements ReturningCommand<UUID> {}
