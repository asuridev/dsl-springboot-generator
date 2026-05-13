package com.test.invoice.application.queries;

import com.test.invoice.application.dtos.InvoiceResponseDto;
import com.test.shared.domain.interfaces.Query;
import jakarta.validation.constraints.NotBlank;

// derived_from: useCases[get-invoice]
public record GetInvoiceQuery(@NotBlank String invoiceId) implements Query<InvoiceResponseDto> {}
