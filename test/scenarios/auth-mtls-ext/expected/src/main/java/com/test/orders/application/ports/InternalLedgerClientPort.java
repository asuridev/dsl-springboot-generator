package com.test.orders.application.ports;

/**
 * Output port — anti-corruption boundary to the internal-ledger bounded context.
 * Implementations live in infrastructure/adapters/internalLedger/.
 *
 * <p>This interface is the single dependency point for all internal-ledger interactions:
 * business operations (from internal-ledger-internal-api.yaml) and FK validations.
 */
public interface InternalLedgerClientPort {
    /**
     * getBalance
     */
    void getBalance();
}
