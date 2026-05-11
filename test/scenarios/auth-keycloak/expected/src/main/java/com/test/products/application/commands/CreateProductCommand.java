package com.test.products.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

// derived_from: useCases[UC-PRD-001]
public record CreateProductCommand(@NotBlank @Size(max = 200) String name) implements Command {}
