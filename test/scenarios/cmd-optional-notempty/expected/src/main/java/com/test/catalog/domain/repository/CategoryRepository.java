package com.test.catalog.domain.repository;

import com.test.catalog.domain.aggregate.Category;
import java.util.UUID;


/**
 * CategoryRepository — Domain repository port (output port).
 * Defines the persistence contract for the Category aggregate.
 * Implementations live in the infrastructure layer.
 */
public interface CategoryRepository {

    Category save(Category category);

    Optional[Category] findById(UUID id);
}
