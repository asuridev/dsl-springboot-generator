package com.test.catalog.infrastructure.persistence.entities;

import com.test.shared.domain.FullAuditableEntity;
import jakarta.persistence.*;
import java.util.UUID;
import lombok.*;

/**
 * TagJpa — JPA Entity for Tag aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "tags")
public class TagJpa extends FullAuditableEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;
}
