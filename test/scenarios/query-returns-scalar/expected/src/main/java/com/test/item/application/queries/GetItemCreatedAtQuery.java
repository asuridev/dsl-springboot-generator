package com.test.item.application.queries;

import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.NotBlank;
import java.time.Instant;

// derived_from: useCases[get-item-created-at]
public record GetItemCreatedAtQuery(@NotBlank String itemId) implements Query<Instant> {}
