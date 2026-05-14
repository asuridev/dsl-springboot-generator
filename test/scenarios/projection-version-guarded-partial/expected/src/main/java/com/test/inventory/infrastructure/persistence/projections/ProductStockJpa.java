package com.test.inventory.infrastructure.persistence.projections;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import lombok.*;

/**
 * ProductStockJpa — persistent local read model.
 * derived_from: bc.inventory.projections[ProductStock] (persistent: true)
 * source: catalog.domainEvents.published[StockInitialized]
 * key: productId
 * upsert: versionGuarded
 *
 * Local read model of product stock levels with version-guarded upserts.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "proj_product_stock")
public class ProductStockJpa {

    @Id
    @Column(name = "product_id", nullable = false, updatable = false)
    private UUID productId;

    @Column(name = "quantity", nullable = false)
    private Integer quantity;

    @Column(name = "reserved_quantity", nullable = false)
    private Integer reservedQuantity;

    @Column(name = "unit_cost", precision = 10, scale = 4, nullable = false)
    private BigDecimal unitCost;

    @Column(name = "last_updated_at", nullable = false)
    private Instant lastUpdatedAt;
}
