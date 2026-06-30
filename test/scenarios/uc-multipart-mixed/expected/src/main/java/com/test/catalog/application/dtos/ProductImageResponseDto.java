package com.test.catalog.application.dtos;

import com.test.shared.domain.valueobject.StoredObject;
import java.util.UUID;

public record ProductImageResponseDto(UUID id, StoredObject media) {}
