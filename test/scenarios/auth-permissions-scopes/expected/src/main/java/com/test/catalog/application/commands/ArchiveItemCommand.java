package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotBlank;

// derived_from: useCases[UC-CAT-004]
public record ArchiveItemCommand(@NotBlank String itemId) implements Command {}
