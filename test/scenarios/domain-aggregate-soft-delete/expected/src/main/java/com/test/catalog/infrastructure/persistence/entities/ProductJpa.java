package com.test.catalog.infrastructure.persistence.entities;

import com.test.shared.domain.FullAuditableEntity;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import lombok.*;

/**
 * ProductJpa — JPA Entity for Product aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "products")
@org.hibernate.annotations.SQLRestriction("deleted_at IS NULL")
public class ProductJpa extends FullAuditableEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "name", length = 200, nullable = false)
    private String name;

    @Column(name = "deleted_at")
    private Instant deletedAt;
}
