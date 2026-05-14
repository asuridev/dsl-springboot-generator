package com.test.catalog.domain.repository;

import com.test.catalog.domain.aggregate.Item;

/**
 * ItemRepository — Domain repository port (output port).
 * Defines the persistence contract for the Item aggregate.
 * Implementations live in the infrastructure layer.
 */
public interface ItemRepository {
    Item save(Item item);
}
