package com.test.ordering.application.commands;

import com.test.ordering.application.dtos.incoming.OrderLineSnapshot;
import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotNull;
import java.util.List;

// derived_from: useCases[process-placed-order]
public record ProcessPlacedOrderCommand(@NotNull List<OrderLineSnapshot> lines) implements Command {}
