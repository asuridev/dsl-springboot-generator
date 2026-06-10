package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.ReturningCommand;
import jakarta.validation.constraints.NotBlank;
import java.util.UUID;

// derived_from: useCases[UC-PRD-001]
public record CreateProductCommand(
    @com.fasterxml.jackson.annotation.JsonIgnore UUID id,
    @NotBlank String name
) implements ReturningCommand<UUID> {}
