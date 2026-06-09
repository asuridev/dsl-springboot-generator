package com.test.ordering.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;

// derived_from: useCases[UC-ORD-002]
public record AddOrderLineCommand(
    String orderId,
    @NotBlank String productId,
    @NotNull Integer quantity,
    List<String> tags
) implements Command {}
