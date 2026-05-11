package com.test.item.application.commands;

import com.test.shared.domain.interfaces.ReturningCommand;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.UUID;

// derived_from: useCases[create-item]
public record CreateItemCommand(
    @NotBlank @Size(max = 100) String name,
    @NotNull BigDecimal price
) implements ReturningCommand<UUID> {}
