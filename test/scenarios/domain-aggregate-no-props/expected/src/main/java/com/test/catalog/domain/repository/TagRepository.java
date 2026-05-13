package com.test.catalog.domain.repository;

import com.test.catalog.domain.aggregate.Tag;
import java.util.Optional;
import java.util.UUID;

/**
 * TagRepository — Domain repository port (output port).
 * Defines the persistence contract for the Tag aggregate.
 * Implementations live in the infrastructure layer.
 */
public interface TagRepository {
    Optional<Tag> findById(UUID id);

    Tag save(Tag tag);
}
