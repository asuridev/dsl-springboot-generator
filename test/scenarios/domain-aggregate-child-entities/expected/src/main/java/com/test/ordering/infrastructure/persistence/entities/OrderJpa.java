package com.test.ordering.infrastructure.persistence.entities;

import com.test.ordering.infrastructure.persistence.entities.OrderLineJpa;
import com.test.shared.domain.FullAuditableEntity;
import jakarta.persistence.*;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.*;

/**
 * OrderJpa — JPA Entity for Order aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "orders")
public class OrderJpa extends FullAuditableEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "customer_id", nullable = false)
    private UUID customerId;

    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id", nullable = false)
    @Builder.Default
    private List<OrderLineJpa> orderLines = new ArrayList<>();
}
