package com.test.products.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.UUID;

// derived_from: useCases[UC-PRD-001]
public record CreateProductCommand(
    @com.fasterxml.jackson.annotation.JsonIgnore UUID id,
    @NotBlank @Size(max = 200) String name
) implements Command {}
