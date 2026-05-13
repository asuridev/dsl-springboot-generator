package com.test.item.application.queries;

import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.NotBlank;
import java.math.BigDecimal;

// derived_from: useCases[get-item-price]
public record GetItemPriceQuery(@NotBlank String itemId) implements Query<BigDecimal> {}
