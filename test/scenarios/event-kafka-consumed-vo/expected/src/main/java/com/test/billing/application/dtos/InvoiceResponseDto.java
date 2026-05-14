package com.test.billing.application.dtos;

import com.test.billing.domain.valueobject.Money;
import java.util.UUID;

public record InvoiceResponseDto(UUID id, UUID orderId, Money totalAmount) {}
