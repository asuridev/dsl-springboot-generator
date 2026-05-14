package com.test.catalog.application.queries;

import com.test.catalog.application.dtos.OrderSummaryResultDto;
import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.NotBlank;

// derived_from: useCases[get-order-summary]
public record GetOrderSummaryQuery(@NotBlank String orderId) implements Query<OrderSummaryResultDto> {}
