package com.test.subscription.domain.errors;

import com.test.shared.domain.customExceptions.DomainException;

/**
 * Too many subscription requests.
 */
// derived_from: errors[RATE_LIMIT_EXCEEDED]
public class RateLimitExceededError extends DomainException {

    public RateLimitExceededError() {
        super("RATE_LIMIT_EXCEEDED");
    }
}
