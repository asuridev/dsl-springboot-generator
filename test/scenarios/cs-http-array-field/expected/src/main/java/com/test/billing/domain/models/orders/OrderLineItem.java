package com.test.billing.domain.models.orders;

/**
 * Domain model for the OrderLineItem concept consumed from the orders BC.
 *
 * <p>ACL (Anti-Corruption Layer): this record is the domain-side abstraction.
 * The corresponding infrastructure DTO lives in
 * {@code infrastructure.adapters.orders.dtos} and is mapped
 * by {@link OrdersAclMapper}. If the external API changes, only the mapper
 * needs updating — domain logic using this type remains untouched.
 */
public record OrderLineItem(String productId, int quantity, java.math.BigDecimal unitPrice) {}
