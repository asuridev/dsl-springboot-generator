package com.test.catalog.infrastructure.persistence.entities;

import jakarta.persistence.*;
import java.util.UUID;
import lombok.*;

/**
 * ItemJpa — JPA Entity for Item aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "items")
public class ItemJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;
}
