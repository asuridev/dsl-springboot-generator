package com.test.orders.infrastructure.persistence.entities;

import com.test.orders.domain.enums.CartStatus;
import jakarta.persistence.*;
import java.util.UUID;
import lombok.*;

/**
 * CartJpa — JPA Entity for Cart aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "carts")
public class CartJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "customer_id")
    private UUID customerId;

    @Column(name = "status")
    @Enumerated(EnumType.STRING)
    private CartStatus status;
}
