package com.test.ordering.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotBlank;

// derived_from: useCases[UC-ORD-003]
public record RemoveOrderLineCommand(@NotBlank String orderId, @NotBlank String lineId) implements Command {}
