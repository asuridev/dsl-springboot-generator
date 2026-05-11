// derived_from: system.yaml#/infrastructure/reliability/outbox
package com.test.shared.infrastructure.outbox;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OutboxEventJpaRepository extends JpaRepository<OutboxEventJpa, UUID> {
    /**
     * Returns up to {@code pageable.pageSize} pending rows in FIFO order.
     * Pending = {@code publishedAt IS NULL}.
     */
    @Query("select o from OutboxEventJpa o where o.publishedAt is null order by o.createdAt asc")
    List<OutboxEventJpa> findPending(Pageable pageable);

    /**
     * Deletes all published rows older than {@code cutoff}.
     * Called by {@link OutboxRelay#purge()} on a scheduled basis.
     *
     * @return number of rows deleted
     */
    @Modifying
    @Query("delete from OutboxEventJpa o where o.publishedAt is not null and o.publishedAt < :cutoff")
    int deletePublishedBefore(@Param("cutoff") Instant cutoff);
}
