-- derived_from: system.yaml#/infrastructure/reliability
-- Tables backing the transactional outbox and consumer idempotency log.
-- Generated only when system.infrastructure.reliability.{outbox|consumerIdempotency} is true.


CREATE TABLE IF NOT EXISTS outbox_event (
    id           UUID         NOT NULL,
    destination  VARCHAR(255) NOT NULL,
    routing_key  VARCHAR(255),
    event_type   VARCHAR(512) NOT NULL,
    payload      TEXT         NOT NULL,
    created_at   TIMESTAMP    NOT NULL,
    published_at TIMESTAMP,
    attempts     INTEGER      NOT NULL DEFAULT 0,
    last_error   VARCHAR(1024),
    CONSTRAINT pk_outbox_event PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_event (published_at, created_at);


