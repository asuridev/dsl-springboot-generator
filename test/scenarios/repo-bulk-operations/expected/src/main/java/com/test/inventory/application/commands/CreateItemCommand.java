package com.test.inventory.application.commands;

import com.test.inventory.application.dtos.ItemResponseDto;
import com.test.shared.domain.interfaces.ReturningCommand;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

// derived_from: useCases[UC-INV-001]
public record CreateItemCommand(
    @NotBlank @Size(max = 100) String sku,
    @NotNull Integer quantity
) implements ReturningCommand<ItemResponseDto> {}
