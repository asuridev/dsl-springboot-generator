package com.test.inventory.domain.models.catalog;

/**
 * Domain model for the AvailableProduct concept consumed from the catalog BC.
 *
 * <p>ACL (Anti-Corruption Layer): this record is the domain-side abstraction.
 * The corresponding infrastructure DTO lives in
 * {@code infrastructure.adapters.catalog.dtos} and is mapped
 * by {@link CatalogAclMapper}. If the external API changes, only the mapper
 * needs updating — domain logic using this type remains untouched.
 */
public record AvailableProduct(String productId, String name, java.math.BigDecimal unitPrice) {}
