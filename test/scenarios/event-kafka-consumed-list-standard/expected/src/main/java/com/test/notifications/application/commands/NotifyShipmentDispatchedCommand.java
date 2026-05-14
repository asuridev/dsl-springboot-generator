package com.test.notifications.application.commands;

import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

// derived_from: useCases[notify-shipment-dispatched]
public record NotifyShipmentDispatchedCommand(
    @NotNull UUID shipmentId,
    @NotNull List<UUID> productIds,
    @NotNull List<Instant> checkpointTimes
) implements Command {}
