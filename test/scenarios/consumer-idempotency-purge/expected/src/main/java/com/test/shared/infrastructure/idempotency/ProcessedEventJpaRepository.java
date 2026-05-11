// derived_from: system.yaml#/infrastructure/reliability/consumerIdempotency
package com.test.shared.infrastructure.idempotency;

import java.time.Instant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProcessedEventJpaRepository
    extends JpaRepository<ProcessedEventJpa, ProcessedEventJpa.ProcessedEventId>
{
    /**
     * Deletes all processed-event rows older than {@code cutoff}.
     * Called by {@link IdempotencyGuard#purge()} on a scheduled basis.
     *
     * @return number of rows deleted
     */
    @Modifying
    @Query("delete from ProcessedEventJpa o where o.processedAt < :cutoff")
    int deleteProcessedBefore(@Param("cutoff") Instant cutoff);
}
