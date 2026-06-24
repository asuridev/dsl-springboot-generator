package com.test.payments.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

// derived_from: useCases[process-payment]
public record ProcessPaymentCommand(@NotNull UUID orderId) implements Command {}
