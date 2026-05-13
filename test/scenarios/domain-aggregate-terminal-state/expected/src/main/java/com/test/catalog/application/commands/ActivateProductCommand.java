package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotBlank;

// derived_from: useCases[UC-PRD-001]
public record ActivateProductCommand(@NotBlank String productId) implements Command {}
