package com.test.ordering.application.dtos.incoming;

import java.math.BigDecimal;
import java.util.UUID;

// derived_from: eventDto:OrderLineSnapshot
// source_bc: sales
public record OrderLineSnapshot(UUID productId, Integer quantity, BigDecimal unitPrice) {}
