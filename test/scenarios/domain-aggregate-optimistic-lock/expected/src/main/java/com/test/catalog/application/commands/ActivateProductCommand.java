package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.Command;

// derived_from: useCases[UC-PRD-001]
public record ActivateProductCommand(String productId) implements Command {}
