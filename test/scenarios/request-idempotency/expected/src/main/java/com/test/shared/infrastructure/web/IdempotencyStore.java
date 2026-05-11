package com.test.shared.infrastructure.web;

import java.time.Duration;

/**
 * Storage abstraction for idempotent request results.
 *
 * The three-state protocol prevents concurrent duplicate executions:
 *   ABSENT  → caller wins the {@link #claim} race → executes handler → {@link #complete}
 *   PENDING → another caller is executing → respond with 409 Conflict
 *   COMPLETE → result is cached → replay stored response
 *
 * derived_from: useCases[*].idempotency.storage
 */
public interface IdempotencyStore {
    /**
     * Snapshot of a previously executed response.
     */
    record StoredResponse(int status, byte[] body, String contentType) {}

    /**
     * Possible states for an idempotency key.
     */
    enum State {
        ABSENT,
        PENDING,
        COMPLETE
    }

    /**
     * Combined result of a {@link #find} call.
     */
    record FindResult(State state, StoredResponse response) {}

    /**
     * Returns the current state and (if COMPLETE) the stored response for the key.
     */
    FindResult find(String key);

    /**
     * Atomically marks {@code key} as PENDING when it is currently ABSENT.
     * Returns {@code true} when the claim was won; {@code false} when another
     * caller already holds PENDING or the key is COMPLETE.
     */
    boolean claim(String key, Duration ttl);

    /**
     * Transitions {@code key} from PENDING to COMPLETE, storing the response.
     * Must only be called by the caller that won {@link #claim}.
     */
    void complete(String key, String requestHash, StoredResponse response, Duration ttl);

    /**
     * Releases a PENDING claim without storing a result (e.g. after a 4xx/5xx).
     * Must only be called by the caller that won {@link #claim}.
     */
    void release(String key);
}
