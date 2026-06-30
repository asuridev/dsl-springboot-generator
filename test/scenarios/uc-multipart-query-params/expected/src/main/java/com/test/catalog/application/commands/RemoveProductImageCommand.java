package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.Command;

// derived_from: useCases[UC-CAT-012]
public record RemoveProductImageCommand(String productId, String imageId) implements Command {}
