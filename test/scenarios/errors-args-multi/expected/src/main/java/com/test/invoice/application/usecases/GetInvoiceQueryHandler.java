package com.test.invoice.application.usecases;

import com.test.invoice.application.dtos.InvoiceResponseDto;
import com.test.invoice.application.mappers.InvoiceApplicationMapper;
import com.test.invoice.application.queries.GetInvoiceQuery;
import com.test.invoice.domain.aggregate.Invoice;
import com.test.invoice.domain.errors.InvoiceAmountMismatchError;
import com.test.invoice.domain.repository.InvoiceRepository;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.QueryHandler;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[get-invoice]
@ApplicationComponent
public class GetInvoiceQueryHandler implements QueryHandler<GetInvoiceQuery, InvoiceResponseDto> {

    private final InvoiceRepository invoiceRepository;
    private final InvoiceApplicationMapper invoiceApplicationMapper;

    public GetInvoiceQueryHandler(
        InvoiceRepository invoiceRepository,
        InvoiceApplicationMapper invoiceApplicationMapper
    ) {
        this.invoiceRepository = invoiceRepository;
        this.invoiceApplicationMapper = invoiceApplicationMapper;
    }

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public InvoiceResponseDto handle(GetInvoiceQuery query) {
        Invoice invoice = invoiceRepository
            .findById(UUID.fromString(query.invoiceId()))
            .orElseThrow(() ->
                new InvoiceAmountMismatchError(
                    UUID.fromString(query.invoiceId()),
                    null /* TODO: supply expected (BigDecimal) */,
                    null /* TODO: supply actual (BigDecimal) */
                )
            );
        return invoiceApplicationMapper.toResponseDto(invoice);
    }
}
