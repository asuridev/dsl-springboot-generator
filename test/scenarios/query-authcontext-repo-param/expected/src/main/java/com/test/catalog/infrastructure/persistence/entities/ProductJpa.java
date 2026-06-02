package com.test.catalog.infrastructure.persistence.entities;

import com.test.catalog.domain.enums.ProductStatus;
import jakarta.persistence.*;
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
public class ProductJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "owner_id", nullable = false)
    private UUID ownerId;

    @Column(name = "name", length = 100, nullable = false)
    private String name;

    @Column(name = "status", nullable = false)
    @Enumerated(EnumType.STRING)
    private ProductStatus status;

    @com.fasterxml.jackson.annotation.JsonIgnore
    @Column(name = "secret_note", length = 100)
    private String secretNote;
}
