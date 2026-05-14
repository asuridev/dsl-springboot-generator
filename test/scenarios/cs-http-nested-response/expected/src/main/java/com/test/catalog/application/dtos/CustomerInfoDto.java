package com.test.catalog.application.dtos;

import java.util.UUID;

public record CustomerInfoDto(UUID customerId, String name, String email) {}
