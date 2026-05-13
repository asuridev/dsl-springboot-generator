package com.test.payment.domain.errors;

import com.test.shared.domain.customExceptions.NotFoundException;

/**
 * Payment not found.
 */
// derived_from: errors[PAYMENT_NOT_FOUND]
public class PaymentNotFoundError extends NotFoundException {

    public PaymentNotFoundError() {
        super("PAYMENT_NOT_FOUND");
    }
}
