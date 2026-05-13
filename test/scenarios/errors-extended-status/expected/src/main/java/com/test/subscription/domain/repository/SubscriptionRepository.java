package com.test.subscription.domain.repository;

import com.test.subscription.domain.aggregate.Subscription;
import java.util.Optional;
import java.util.UUID;

/**
 * SubscriptionRepository — Domain repository port (output port).
 * Defines the persistence contract for the Subscription aggregate.
 * Implementations live in the infrastructure layer.
 */
public interface SubscriptionRepository {
    Subscription save(Subscription subscription);

    Optional<Subscription> findById(UUID id);
}
