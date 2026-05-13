package com.test.item.application.queries;

import com.test.item.application.dtos.ItemResponseDto;
import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Optional;

// derived_from: useCases[find-item-by-name]
public record FindItemByNameQuery(@NotBlank @Size(max = 100) String name) implements Query<Optional<ItemResponseDto>> {}
