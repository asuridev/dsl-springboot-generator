package com.test.subscription.application.commands;

import com.test.shared.domain.interfaces.ReturningCommand;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.UUID;

// derived_from: useCases[create-subscription]
public record CreateSubscriptionCommand(@NotBlank @Size(max = 50) String plan) implements ReturningCommand<UUID> {}
