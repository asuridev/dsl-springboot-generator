package com.test.invoice.application.dtos;

import java.math.BigDecimal;
import java.util.UUID;

public record InvoiceResponseDto(UUID id, String number, BigDecimal amount) {}
