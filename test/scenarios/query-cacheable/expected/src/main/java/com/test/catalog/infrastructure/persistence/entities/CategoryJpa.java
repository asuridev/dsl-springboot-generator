package com.test.catalog.infrastructure.persistence.entities;

import com.test.shared.domain.FullAuditableEntity;
import jakarta.persistence.*;
import java.util.UUID;
import lombok.*;

/**
 * CategoryJpa — JPA Entity for Category aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "categories")
public class CategoryJpa extends FullAuditableEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "name", length = 100)
    private String name;

    @Column(name = "parent_id")
    private UUID parentId;
}
