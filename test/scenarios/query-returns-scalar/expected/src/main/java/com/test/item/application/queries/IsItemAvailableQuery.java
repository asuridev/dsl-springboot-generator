package com.test.item.application.queries;

import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.NotBlank;

// derived_from: useCases[is-item-available]
public record IsItemAvailableQuery(@NotBlank String itemId) implements Query<Boolean> {}
