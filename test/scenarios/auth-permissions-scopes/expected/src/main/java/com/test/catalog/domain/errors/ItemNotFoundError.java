package com.test.catalog.domain.errors;

import com.test.shared.domain.customExceptions.NotFoundException;

// derived_from: errors[ITEM_NOT_FOUND]
public class ItemNotFoundError extends NotFoundException {

    public ItemNotFoundError() {
        super("ITEM_NOT_FOUND");
    }
}
