package com.test.catalog.infrastructure.persistence.entities;

import com.test.catalog.domain.enums.CategoryStatus;
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
public class CategoryJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "name", length = 200, nullable = false)
    private String name;

    @Column(name = "status")
    @Enumerated(EnumType.STRING)
    private CategoryStatus status;
}
