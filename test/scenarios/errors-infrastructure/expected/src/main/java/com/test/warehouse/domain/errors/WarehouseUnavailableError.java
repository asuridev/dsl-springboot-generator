package com.test.warehouse.domain.errors;

import com.test.shared.domain.customExceptions.DomainException;

/**
 * Warehouse data store is temporarily unavailable.
 */
// derived_from: errors[WAREHOUSE_UNAVAILABLE]
public class WarehouseUnavailableError extends DomainException {

    public WarehouseUnavailableError() {
        super("WAREHOUSE_UNAVAILABLE");
    }

    public WarehouseUnavailableError(Throwable cause) {
        super("WAREHOUSE_UNAVAILABLE", cause);
    }
}
