package com.test.inventory.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

// derived_from: useCases[release-stock]
public record ReleaseStockCommand(@NotNull UUID orderId) implements Command {}
