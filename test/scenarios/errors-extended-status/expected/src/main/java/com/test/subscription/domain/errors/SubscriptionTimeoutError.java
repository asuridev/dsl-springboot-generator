package com.test.subscription.domain.errors;

import com.test.shared.domain.customExceptions.DomainException;

/**
 * Subscription provisioning timed out.
 */
// derived_from: errors[SUBSCRIPTION_TIMEOUT]
public class SubscriptionTimeoutError extends DomainException {

    public SubscriptionTimeoutError() {
        super("SUBSCRIPTION_TIMEOUT");
    }
}
