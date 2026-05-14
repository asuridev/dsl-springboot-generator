package com.test.calendar.infrastructure.persistence.entities;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.util.UUID;
import lombok.*;

/**
 * SlotJpa — JPA Entity for Slot aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "slots")
public class SlotJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "slot_date")
    private LocalDate slotDate;
}
