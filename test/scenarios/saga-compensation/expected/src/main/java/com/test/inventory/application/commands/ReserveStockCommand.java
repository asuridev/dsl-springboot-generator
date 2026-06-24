package com.test.inventory.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

// derived_from: useCases[reserve-stock]
public record ReserveStockCommand(@NotNull UUID orderId, @NotNull UUID customerId) implements Command {}
