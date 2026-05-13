package com.test.catalog.application.commands;

import com.test.shared.domain.interfaces.ReturningCommand;
import java.util.UUID;

// derived_from: useCases[UC-TAG-001]
public record CreateTagCommand() implements ReturningCommand<UUID> {}
