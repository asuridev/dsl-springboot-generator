package com.test.warehouse.infrastructure.persistence.entities;

import jakarta.persistence.*;
import java.util.UUID;
import lombok.*;

/**
 * ShipmentJpa — JPA Entity for Shipment aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "shipments")
public class ShipmentJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;
}
