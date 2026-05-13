package com.test.item.application.queries;

import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.UUID;

// derived_from: useCases[get-item-id]
public record GetItemIdQuery(@NotBlank @Size(max = 100) String name) implements Query<UUID> {}
