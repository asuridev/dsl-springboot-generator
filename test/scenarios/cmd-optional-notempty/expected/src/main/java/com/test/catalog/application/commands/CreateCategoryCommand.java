package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

// derived_from: useCases[UC-CAT-001]
public record CreateCategoryCommand(
    @NotBlank String id,
    @NotBlank @Size(max = 120) @NotEmpty String name
) implements Command {}
