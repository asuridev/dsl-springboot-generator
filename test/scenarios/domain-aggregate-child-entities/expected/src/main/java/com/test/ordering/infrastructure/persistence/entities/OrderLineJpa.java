package com.test.ordering.infrastructure.persistence.entities;

import jakarta.persistence.*;
import java.util.List;
import java.util.UUID;
import lombok.*;

/**
 * OrderLineJpa — JPA Entity for OrderLine child entity.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "order_lines")
public class OrderLineJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "product_id", nullable = false)
    private UUID productId;

    @Column(name = "quantity", nullable = false)
    private Integer quantity;

    @Column(name = "tags")
    private List<String> tags;
}
