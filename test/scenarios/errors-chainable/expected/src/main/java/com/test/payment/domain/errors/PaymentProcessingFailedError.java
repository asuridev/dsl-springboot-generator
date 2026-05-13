package com.test.payment.domain.errors;

import com.test.shared.domain.customExceptions.BusinessException;

/**
 * Payment processing failed due to an upstream provider error.
 */
// derived_from: errors[PAYMENT_PROCESSING_FAILED]
public class PaymentProcessingFailedError extends BusinessException {

    public PaymentProcessingFailedError() {
        super("PAYMENT_PROCESSING_FAILED");
    }

    public PaymentProcessingFailedError(Throwable cause) {
        super("PAYMENT_PROCESSING_FAILED", cause);
    }
}
