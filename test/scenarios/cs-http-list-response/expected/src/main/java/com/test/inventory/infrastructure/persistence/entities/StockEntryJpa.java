package com.test.inventory.infrastructure.persistence.entities;

import jakarta.persistence.*;
import java.util.UUID;
import lombok.*;

/**
 * StockEntryJpa — JPA Entity for StockEntry aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "stock_entries")
public class StockEntryJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;
}
