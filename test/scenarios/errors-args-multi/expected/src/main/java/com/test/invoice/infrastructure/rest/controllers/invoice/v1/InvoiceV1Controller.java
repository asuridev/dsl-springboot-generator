package com.test.invoice.infrastructure.rest.controllers.invoice.v1;

import com.test.invoice.application.dtos.InvoiceResponseDto;
import com.test.invoice.application.queries.GetInvoiceQuery;
import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/invoices")
@Slf4j
@Tag(name = "Invoice", description = "Invoice Management API")
public class InvoiceV1Controller {

    private final UseCaseMediator useCaseMediator;

    public InvoiceV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * Get invoice by ID.
     */
    @GetMapping("/{invoiceId}")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Get invoice by ID.")
    public InvoiceResponseDto getInvoice(@PathVariable String invoiceId) {
        log.info("getInvoice — invoiceId: {}", invoiceId);
        return useCaseMediator.dispatch(new GetInvoiceQuery(invoiceId));
    }
}
