-- derived_from: system.yaml#/infrastructure/reliability
-- Tables backing the transactional outbox and consumer idempotency log.
-- Generated only when system.infrastructure.reliability.{outbox|consumerIdempotency} is true.



CREATE TABLE IF NOT EXISTS processed_event (
    handler_id   VARCHAR(512) NOT NULL,
    event_id     VARCHAR(64)  NOT NULL,
    processed_at TIMESTAMP    NOT NULL,
    CONSTRAINT pk_processed_event PRIMARY KEY (handler_id, event_id)
);

