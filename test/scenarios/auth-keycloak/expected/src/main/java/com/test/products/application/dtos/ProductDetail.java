package com.test.products.application.dtos;

import java.time.Instant;
import java.util.UUID;

public record ProductDetail(UUID id, String name, String status, Instant createdAt, Instant updatedAt) {}
