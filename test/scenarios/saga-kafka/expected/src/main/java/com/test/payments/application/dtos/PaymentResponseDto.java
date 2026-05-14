package com.test.payments.application.dtos;

import java.math.BigDecimal;
import java.util.UUID;

public record PaymentResponseDto(UUID id, UUID orderId, BigDecimal amount) {}
