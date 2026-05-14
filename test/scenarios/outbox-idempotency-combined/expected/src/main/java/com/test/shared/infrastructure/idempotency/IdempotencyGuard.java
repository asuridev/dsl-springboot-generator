// derived_from: system.yaml#/infrastructure/reliability/consumerIdempotency
package com.test.shared.infrastructure.idempotency;

import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Consumer-side idempotency guard.
 *
 * Listeners call {@link #tryRecord(String, String)} before dispatching the
 * inbound message. The guard atomically inserts a {@code (handlerId, eventId)}
 * row and reports {@code true} for first occurrences, {@code false} for
 * duplicates (PK violation caught and swallowed).
 *
 * derived_from: system.yaml#/infrastructure/reliability/consumerIdempotency
 */
@Component
public class IdempotencyGuard {

    private static final Logger log = LoggerFactory.getLogger(IdempotencyGuard.class);

    private final ProcessedEventJpaRepository repository;

    public IdempotencyGuard(ProcessedEventJpaRepository repository) {
        this.repository = repository;
    }

    /**
     * Returns {@code true} if this is the first time the pair is seen and the
     * caller MUST process the message; {@code false} if it has been processed
     * before and the caller MUST skip.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean tryRecord(String handlerId, String eventId) {
        ProcessedEventJpa.ProcessedEventId pk = ProcessedEventJpa.ProcessedEventId.builder()
            .handlerId(handlerId)
            .eventId(eventId)
            .build();
        if (repository.existsById(pk)) {
            return false;
        }
        try {
            repository.save(ProcessedEventJpa.builder().id(pk).processedAt(Instant.now()).build());
            return true;
        } catch (DataIntegrityViolationException duplicate) {
            return false;
        }
    }
}
