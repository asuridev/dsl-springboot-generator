package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.Command;

// derived_from: useCases[UC-CAT-004]
public record ArchiveItemCommand(String itemId) implements Command {}
