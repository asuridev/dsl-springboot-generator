package com.test.ordering.infrastructure.persistence.entities;

import jakarta.persistence.*;
import java.util.UUID;
import lombok.*;

/**
 * OrderRecordJpa — JPA Entity for OrderRecord aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "order_records")
public class OrderRecordJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "buyer_id")
    private UUID buyerId;

    @Column(name = "status", columnDefinition = "TEXT")
    private String status;
}
