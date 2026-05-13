package com.test.payment.application.dtos;

import java.math.BigDecimal;
import java.util.UUID;

public record PaymentResponseDto(UUID id, BigDecimal amount) {}
