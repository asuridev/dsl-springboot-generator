package com.test.inventory.infrastructure.persistence.entities;

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

    @Column(name = "sku", length = 100, nullable = false)
    private String sku;

    @Column(name = "quantity", nullable = false)
    private Integer quantity;
}
