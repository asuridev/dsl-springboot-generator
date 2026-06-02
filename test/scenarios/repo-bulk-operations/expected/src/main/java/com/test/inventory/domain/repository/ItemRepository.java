package com.test.inventory.domain.repository;

import com.test.inventory.domain.aggregate.Item;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * ItemRepository — Domain repository port (output port).
 * Defines the persistence contract for the Item aggregate.
 * Implementations live in the infrastructure layer.
 */
public interface ItemRepository {
    Optional<Item> findById(UUID id);

    Item save(Item item);

    // derived_from: bulk-operations
    List<Item> saveAll(List<Item> entities);

    // derived_from: bulk-operations
    List<Item> findAllById(List<UUID> ids);

    // derived_from: bulk-operations
    long count();
}
