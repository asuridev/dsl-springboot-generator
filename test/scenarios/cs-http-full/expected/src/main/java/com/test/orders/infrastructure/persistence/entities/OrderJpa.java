package com.test.orders.infrastructure.persistence.entities;

import jakarta.persistence.*;
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
public class OrderJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "status", length = 50)
    private String status;
}
