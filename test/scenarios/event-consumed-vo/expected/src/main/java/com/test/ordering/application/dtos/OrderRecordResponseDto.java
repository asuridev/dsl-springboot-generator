package com.test.ordering.application.dtos;

import java.util.UUID;

public record OrderRecordResponseDto(UUID id, UUID buyerId, String status) {}
