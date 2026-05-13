package com.test.ordering.application.commands;

import com.test.shared.domain.interfaces.ReturningCommand;
import jakarta.validation.constraints.NotBlank;
import java.util.UUID;

// derived_from: useCases[UC-ORD-001]
public record CreateOrderCommand(@NotBlank String customerId) implements ReturningCommand<UUID> {}
