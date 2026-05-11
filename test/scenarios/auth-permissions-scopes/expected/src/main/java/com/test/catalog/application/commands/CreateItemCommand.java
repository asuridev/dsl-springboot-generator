package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

// derived_from: useCases[UC-CAT-002]
public record CreateItemCommand(@NotBlank @Size(max = 200) String name) implements Command {}
