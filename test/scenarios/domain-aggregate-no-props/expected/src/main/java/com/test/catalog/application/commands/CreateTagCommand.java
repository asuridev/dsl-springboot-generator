package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.ReturningCommand;
import java.util.UUID;

// derived_from: useCases[UC-TAG-001]
public record CreateTagCommand(
    @com.fasterxml.jackson.annotation.JsonIgnore UUID id
) implements ReturningCommand<UUID> {}
