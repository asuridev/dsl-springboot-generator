package com.test.catalog.application.dtos;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.test.catalog.domain.enums.ProductStatus;
import com.test.catalog.domain.valueobject.Money;
import java.util.UUID;

/**
 * Compact view of a product for listing pages.
 */

// derived_from: projection:ProductSummary

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ProductSummary(
    UUID id,
    String name,
    ProductStatus status,
    Money price,
    @JsonProperty("slug_url") String slugUrl
) {}
