package com.test.order.application.queries;

import com.test.order.application.dtos.OrderResponseDto;
import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.NotBlank;

// derived_from: useCases[get-order]
public record GetOrderQuery(@NotBlank String orderId) implements Query<OrderResponseDto> {}
