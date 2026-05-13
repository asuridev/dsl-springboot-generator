package com.test.payments.application.ports;

/**
 * Output port — anti-corruption boundary to the billing-service bounded context.
 * Implementations live in infrastructure/adapters/billingService/.
 *
 * <p>This interface is the single dependency point for all billing-service interactions:
 * business operations (from billing-service-internal-api.yaml) and FK validations.
 */
public interface BillingServiceClientPort {
    /**
     * createInvoice
     */
    void createInvoice();
}
