package com.test.inventory.infrastructure.persistence.entities;

import jakarta.persistence.*;
import java.util.UUID;
import lombok.*;

/**
 * InventoryItemJpa — JPA Entity for InventoryItem aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "inventory_items")
public class InventoryItemJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "product_id")
    private UUID productId;

    @Column(name = "stock")
    private Integer stock;
}
