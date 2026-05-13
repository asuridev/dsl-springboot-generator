package com.test.warehouse.domain.errors;

import com.test.shared.domain.customExceptions.NotFoundException;

/**
 * Stock record not found.
 */
// derived_from: errors[STOCK_NOT_FOUND]
public class StockNotFoundError extends NotFoundException {

    public StockNotFoundError() {
        super("STOCK_NOT_FOUND");
    }
}
