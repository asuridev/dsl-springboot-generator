package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

// derived_from: useCases[UC-CAT-003]
public record UpdateItemCommand(String itemId, @NotBlank @Size(max = 200) String name) implements Command {}
