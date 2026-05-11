package com.test.catalog.infrastructure.persistence.entities;

import com.test.shared.domain.FullAuditableEntity;
import jakarta.persistence.*;
import java.util.UUID;
import lombok.*;

/**
 * ItemJpa — JPA Entity for Item aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "items")
public class ItemJpa extends FullAuditableEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "name", length = 200)
    private String name;

    @Column(name = "status", length = 20)
    private String status;
}
