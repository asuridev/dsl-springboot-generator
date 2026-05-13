package com.test.order.application.queries;

import com.test.order.application.dtos.OrderResponseDto;
import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

// derived_from: useCases[get-order-by-ref]
public record GetOrderByRefQuery(@NotBlank @Size(max = 50) String reference) implements Query<OrderResponseDto> {}
