package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.Command;

// derived_from: useCases[UC-CAT-010]
public record ArchiveCategoryCommand(String categoryId) implements Command {}
