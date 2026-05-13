package com.test.item.application.dtos;

import java.math.BigDecimal;
import java.util.UUID;

public record ItemResponseDto(UUID id, String name, BigDecimal price) {}
