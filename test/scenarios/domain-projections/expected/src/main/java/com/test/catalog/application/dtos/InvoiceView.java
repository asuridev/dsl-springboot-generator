package com.test.catalog.application.dtos;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Invoice view with a derived field.
 */

// derived_from: projection:InvoiceView

@JsonInclude(JsonInclude.Include.NON_NULL)
public record InvoiceView(Long subtotal, Long totalWithTax) {}
