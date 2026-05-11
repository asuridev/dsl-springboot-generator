package com.test.healthcheck.infrastructure.persistence.entities;

import jakarta.persistence.*;
import java.util.UUID;
import lombok.*;

/**
 * ServiceHealthJpa — JPA Entity for ServiceHealth aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "service_healths")
public class ServiceHealthJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;
}
