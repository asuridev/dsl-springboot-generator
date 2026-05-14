package com.test.payments.application.dtos;

import java.util.UUID;

public record PaymentResponseDto(UUID id, UUID orderId) {}
