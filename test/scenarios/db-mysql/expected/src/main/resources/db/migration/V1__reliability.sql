-- derived_from: system.yaml#/infrastructure/reliability
-- Tables backing the transactional outbox and consumer idempotency log.
-- Generated only when system.infrastructure.reliability.{outbox|consumerIdempotency} is true.


CREATE TABLE IF NOT EXISTS outbox_event (
    id           CHAR(36)         NOT NULL,
    destination  VARCHAR(255) NOT NULL,
    routing_key  VARCHAR(255),
    event_type   VARCHAR(512) NOT NULL,
    payload      LONGTEXT         NOT NULL,
    created_at   DATETIME    NOT NULL,
    published_at DATETIME,
    attempts     INT      NOT NULL DEFAULT 0,
    last_error   VARCHAR(1024),
    CONSTRAINT pk_outbox_event PRIMARY KEY (id)
);

CREATE INDEX idx_outbox_pending ON outbox_event (published_at, created_at);


CREATE TABLE IF NOT EXISTS processed_event (
    handler_id   VARCHAR(512) NOT NULL,
    event_id     VARCHAR(64)  NOT NULL,
    processed_at DATETIME    NOT NULL,
    CONSTRAINT pk_processed_event PRIMARY KEY (handler_id, event_id)
);

