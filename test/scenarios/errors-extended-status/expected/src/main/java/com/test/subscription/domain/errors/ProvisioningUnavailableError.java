package com.test.subscription.domain.errors;

import com.test.shared.domain.customExceptions.DomainException;

/**
 * Subscription provisioning service is unavailable.
 */
// derived_from: errors[PROVISIONING_UNAVAILABLE]
public class ProvisioningUnavailableError extends DomainException {

    public ProvisioningUnavailableError() {
        super("PROVISIONING_UNAVAILABLE");
    }
}
