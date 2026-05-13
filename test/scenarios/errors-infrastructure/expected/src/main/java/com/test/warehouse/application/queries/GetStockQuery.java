package com.test.warehouse.application.queries;

import com.test.shared.domain.interfaces.Query;
import com.test.warehouse.application.dtos.StockResponseDto;
import jakarta.validation.constraints.NotBlank;

// derived_from: useCases[get-stock]
public record GetStockQuery(@NotBlank String stockId) implements Query<StockResponseDto> {}
