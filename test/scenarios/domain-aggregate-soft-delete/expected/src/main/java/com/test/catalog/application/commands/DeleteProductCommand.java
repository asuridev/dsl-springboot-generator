package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.Command;

// derived_from: useCases[UC-PRD-002]
public record DeleteProductCommand(String productId) implements Command {}
