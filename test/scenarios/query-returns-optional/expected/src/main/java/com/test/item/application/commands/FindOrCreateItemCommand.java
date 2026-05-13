package com.test.item.application.commands;

import com.test.item.application.dtos.ItemResponseDto;
import com.test.shared.domain.interfaces.ReturningCommand;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.Optional;

// derived_from: useCases[find-or-create-item]
public record FindOrCreateItemCommand(
    @NotBlank @Size(max = 100) String name,
    @NotNull BigDecimal price
) implements ReturningCommand<Optional<ItemResponseDto>> {}
