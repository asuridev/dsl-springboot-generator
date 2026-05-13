package com.test.invoice.domain.errors;

import com.test.shared.domain.customExceptions.BusinessException;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * Invoice amount does not match the expected value.
 */
// derived_from: errors[INVOICE_AMOUNT_MISMATCH]
public class InvoiceAmountMismatchError extends BusinessException {

    public InvoiceAmountMismatchError(UUID invoiceId, BigDecimal expected, BigDecimal actual) {
        super(
            "Invoice " +
                String.valueOf(invoiceId) +
                " has amount " +
                String.valueOf(expected) +
                " but " +
                String.valueOf(actual) +
                " was provided.",
            "INVOICE_AMOUNT_MISMATCH",
            422,
            new Object[] { invoiceId, expected, actual }
        );
    }
}
