package com.test.orders.infrastructure.persistence.projections;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import lombok.*;

/**
 * LocalProductViewJpa — persistent local read model.
 * derived_from: bc.orders.projections[LocalProductView] (persistent: true)
 * source: catalog.domainEvents.published[ProductActivated]
 * key: productId
 * upsert: lastWriteWins
 *
 * Local read model of products maintained by catalog events via Kafka.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "proj_local_product_view")
public class LocalProductViewJpa {

    @Id
    @Column(name = "product_id", nullable = false, updatable = false)
    private UUID productId;

    @Column(name = "product_name", columnDefinition = "TEXT", nullable = false)
    private String productName;

    @Column(name = "price", precision = 10, scale = 2, nullable = false)
    private BigDecimal price;

    @Column(name = "last_updated_at", nullable = false)
    private Instant lastUpdatedAt;
}
