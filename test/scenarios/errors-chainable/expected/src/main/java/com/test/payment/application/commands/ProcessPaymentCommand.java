package com.test.payment.application.commands;

import com.test.shared.domain.interfaces.ReturningCommand;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.UUID;

// derived_from: useCases[process-payment]
public record ProcessPaymentCommand(@NotNull BigDecimal amount) implements ReturningCommand<UUID> {}
