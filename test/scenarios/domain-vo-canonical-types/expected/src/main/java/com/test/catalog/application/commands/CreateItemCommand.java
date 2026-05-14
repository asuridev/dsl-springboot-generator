package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotBlank;

// derived_from: useCases[UC-001]
public record CreateItemCommand(@NotBlank String id) implements Command {}
