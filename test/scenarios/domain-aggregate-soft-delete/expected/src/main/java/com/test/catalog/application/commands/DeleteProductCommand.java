package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotBlank;

// derived_from: useCases[UC-PRD-002]
public record DeleteProductCommand(@NotBlank String productId) implements Command {}
