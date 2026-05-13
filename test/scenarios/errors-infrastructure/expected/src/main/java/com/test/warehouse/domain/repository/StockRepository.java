package com.test.warehouse.domain.repository;

import com.test.warehouse.domain.aggregate.Stock;
import java.util.Optional;
import java.util.UUID;

/**
 * StockRepository — Domain repository port (output port).
 * Defines the persistence contract for the Stock aggregate.
 * Implementations live in the infrastructure layer.
 */
public interface StockRepository {
    Stock save(Stock stock);

    Optional<Stock> findById(UUID id);
}
