package com.test.billing.application.commands;

import com.test.billing.domain.enums.OrderStatus;
import com.test.billing.domain.valueobject.Money;
import com.test.shared.domain.interfaces.Command;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

// derived_from: useCases[create-invoice-from-order]
public record CreateInvoiceFromOrderCommand(
    @NotNull UUID orderId,
    @NotNull Money totalAmount,
    @NotNull OrderStatus status
) implements Command {}
