package com.test.orders.infrastructure.adapters.catalog.dtos;

/**
 * Infrastructure DTO — shape of the MoneyDto response from catalog BC.
 * Only used inside the adapter layer; never exposed to application or domain layers.
 */
public record MoneyDto(String amount, String currency) {}
