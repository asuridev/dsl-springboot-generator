package com.test.booking.infrastructure.persistence.projections;

import jakarta.persistence.*;
import java.time.Instant;
import java.time.LocalDate;
import lombok.*;

/**
 * DailyCapacityJpa — persistent local read model.
 * derived_from: bc.booking.projections[DailyCapacity] (persistent: true)
 * source: calendar.domainEvents.published[SlotCapacityPublished]
 * key: date
 * upsert: lastWriteWins
 *
 * Local read model of daily slot capacity keyed by calendar date.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "proj_daily_capacity")
public class DailyCapacityJpa {

    @Id
    @Column(name = "date", nullable = false, updatable = false)
    private LocalDate date;

    @Column(name = "total_slots", nullable = false)
    private Integer totalSlots;

    @Column(name = "booked_slots", nullable = false)
    private Integer bookedSlots;

    @Column(name = "last_updated_at", nullable = false)
    private Instant lastUpdatedAt;
}
