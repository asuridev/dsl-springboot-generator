package com.test.catalog.application.dtos;

import com.test.catalog.domain.enums.ProductStatus;
import com.test.catalog.domain.valueobject.Money;
import java.util.UUID;

/**
 * Minimal product view for price-validation lookups.
 */

// derived_from: projection:ProductPriceValidation

public record ProductPriceValidation(UUID id, ProductStatus status, Money price) {}
