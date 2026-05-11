package com.test.payments.application.ports;

import java.util.UUID;

/**
 * Output port — anti-corruption boundary to the auth-service bounded context.
 * Implementations live in infrastructure/adapters/authService/.
 *
 * <p>This interface is the single dependency point for all auth-service interactions:
 * business operations (from auth-service-internal-api.yaml) and FK validations.
 */
public interface AuthServiceClientPort {
    /**
     * createInvoice
     */
    void createInvoice();
}
