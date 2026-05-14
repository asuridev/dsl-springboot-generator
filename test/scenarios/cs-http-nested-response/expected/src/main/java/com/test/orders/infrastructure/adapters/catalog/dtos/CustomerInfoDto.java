package com.test.orders.infrastructure.adapters.catalog.dtos;

/**
 * Infrastructure DTO — shape of the CustomerInfoDto response from catalog BC.
 * Only used inside the adapter layer; never exposed to application or domain layers.
 */
public record CustomerInfoDto(String customerId, String name, String email) {}
