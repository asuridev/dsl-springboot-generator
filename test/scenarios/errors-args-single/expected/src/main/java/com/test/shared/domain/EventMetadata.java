package com.test.shared.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * Canonical metadata attached to every domain event.
 *
 * Carries all cross-cutting fields that the dispatch infrastructure needs
 * (idempotency, tracing, schema versioning) without polluting the
 * business payload.
 *
 * Fields:
 *   eventId         — unique identifier of THIS occurrence (idempotency key).
 *   eventType       — logical name of the event (e.g. "ProductActivated").
 *   eventVersion    — schema version of the payload (default 1).
 *   occurredAt      — instant the event was raised inside the aggregate.
 *   sourceBc        — bounded context that produced the event.
 *   correlationId   — id of the originating user request (propagated end-to-end).
 *   causationId     — id of the immediately preceding event/command, if any.
 *
 * Both correlationId and causationId may be {@code null} when the event is
 * raised outside a request context.
 */
public record EventMetadata(
    UUID eventId,
    String eventType,
    int eventVersion,
    Instant occurredAt,
    String sourceBc,
    String correlationId,
    String causationId
) {
    /**
     * Convenience factory used by aggregates when raising an event.
     * Generates a fresh {@link UUID} and stamps {@link Instant#now()}.
     * Correlation/causation are left {@code null}; the messaging layer
     * is responsible for filling them from the ambient request context
     * before the event leaves the application.
     */
    public static EventMetadata now(String eventType, int eventVersion, String sourceBc) {
        return new EventMetadata(UUID.randomUUID(), eventType, eventVersion, Instant.now(), sourceBc, null, null);
    }
}
