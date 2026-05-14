// derived_from: system.yaml#/infrastructure/reliability/consumerIdempotency
package com.test.shared.infrastructure.idempotency;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface ProcessedEventJpaRepository
    extends JpaRepository<ProcessedEventJpa, ProcessedEventJpa.ProcessedEventId> {}
