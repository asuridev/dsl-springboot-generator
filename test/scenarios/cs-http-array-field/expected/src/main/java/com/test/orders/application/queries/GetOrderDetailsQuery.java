package com.test.orders.application.queries;

import com.test.orders.application.dtos.OrderDetailsResultDto;
import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.NotBlank;

// derived_from: useCases[get-order-details]
public record GetOrderDetailsQuery(@NotBlank String orderId) implements Query<OrderDetailsResultDto> {}
