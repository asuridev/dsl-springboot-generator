package com.test.subscription.domain.errors;

import com.test.shared.domain.customExceptions.DomainException;

/**
 * Payment is required to activate this subscription.
 */
// derived_from: errors[PAYMENT_REQUIRED]
public class PaymentRequiredError extends DomainException {

    public PaymentRequiredError() {
        super("PAYMENT_REQUIRED");
    }
}
