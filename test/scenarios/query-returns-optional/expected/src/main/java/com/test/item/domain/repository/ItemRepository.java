package com.test.item.domain.repository;

import com.test.item.domain.aggregate.Item;
import java.util.Optional;
import java.util.UUID;

/**
 * ItemRepository — Domain repository port (output port).
 * Defines the persistence contract for the Item aggregate.
 * Implementations live in the infrastructure layer.
 */
public interface ItemRepository {
    Optional<Item> findItemByName(String name);

    Item save(Item item);

    Optional<Item> findById(UUID id);
}
