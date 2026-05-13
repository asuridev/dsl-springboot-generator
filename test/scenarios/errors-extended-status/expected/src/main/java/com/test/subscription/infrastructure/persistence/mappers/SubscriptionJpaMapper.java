package com.test.subscription.infrastructure.persistence.mappers;

import com.test.subscription.domain.aggregate.Subscription;
import com.test.subscription.infrastructure.persistence.entities.SubscriptionJpa;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * SubscriptionJpaMapper — stateless converter between the domain model
 * and its JPA representation.
 *
 * Extracted from SubscriptionRepositoryImpl to keep the adapter focused
 * on persistence orchestration. All conversions are pure functions; introduce
 * dependencies (e.g. value-object factories) only if a domain rule explicitly
 * requires them.
 */
@Component
public class SubscriptionJpaMapper {

    // ─── JPA → Domain ────────────────────────────────────────────────────────

    public Subscription toDomain(SubscriptionJpa jpa) {
        return new Subscription(jpa.getId(), jpa.getPlan());
    }

    // ─── Domain → JPA ────────────────────────────────────────────────────────

    public SubscriptionJpa toJpa(Subscription domain) {
        SubscriptionJpa jpa = SubscriptionJpa.builder().id(domain.getId()).plan(domain.getPlan()).build();
        return jpa;
    }
}
