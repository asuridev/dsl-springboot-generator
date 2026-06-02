package com.test.orders.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotBlank;

// derived_from: useCases[UC-ORD-001]
public record PlaceOrderCommand(@NotBlank String customerId) implements Command {}
