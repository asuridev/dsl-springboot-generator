package com.test.ordering.application.commands;

import com.test.shared.domain.interfaces.Command;

// derived_from: useCases[UC-ORD-003]
public record RemoveOrderLineCommand(String orderId, String lineId) implements Command {}
