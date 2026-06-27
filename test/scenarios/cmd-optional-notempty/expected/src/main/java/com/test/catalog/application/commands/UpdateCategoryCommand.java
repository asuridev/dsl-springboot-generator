package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.Size;

// derived_from: useCases[UC-CAT-002]
public record UpdateCategoryCommand(
    String categoryId,
    @Size(max = 120) String name,
    @Size(max = 500) String description
) implements Command {}
