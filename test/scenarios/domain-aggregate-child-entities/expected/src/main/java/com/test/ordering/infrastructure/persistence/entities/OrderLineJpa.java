package com.test.ordering.infrastructure.persistence.entities;

import jakarta.persistence.*;
import java.util.ArrayList;
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

    @ElementCollection
    @CollectionTable(name = "order_line_tags", joinColumns = @JoinColumn(name = "order_line_id"))
    @Column(name = "tags")
    @Builder.Default
    private List<String> tags = new ArrayList<>();
}
