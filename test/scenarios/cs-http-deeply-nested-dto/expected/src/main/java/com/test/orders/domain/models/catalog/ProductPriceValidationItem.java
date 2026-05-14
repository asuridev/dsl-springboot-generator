package com.test.orders.domain.models.catalog;

import com.test.orders.domain.valueobject.Money;

/**
 * Domain model for the ProductPriceValidationItem concept consumed from the catalog BC.
 *
 * <p>ACL (Anti-Corruption Layer): this record is the domain-side abstraction.
 * The corresponding infrastructure DTO lives in
 * {@code infrastructure.adapters.catalog.dtos} and is mapped
 * by {@link CatalogAclMapper}. If the external API changes, only the mapper
 * needs updating — domain logic using this type remains untouched.
 */
public record ProductPriceValidationItem(String productId, boolean available, Money unitPrice) {}
