package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.UUID;

// derived_from: useCases[UC-CAT-002]
public record CreateItemCommand(
    @com.fasterxml.jackson.annotation.JsonIgnore UUID id,
    @NotBlank @Size(max = 200) String name
) implements Command {}
