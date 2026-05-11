package com.test.sales.infrastructure.persistence.entities;

import jakarta.persistence.*;
import java.util.UUID;
import lombok.*;

/**
 * SalesOrderJpa — JPA Entity for SalesOrder aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "sales_orders")
public class SalesOrderJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "buyer_id")
    private UUID buyerId;

    @Column(name = "status", columnDefinition = "TEXT")
    private String status;
}
