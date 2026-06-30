package com.test.catalog.infrastructure.persistence.entities;

import com.test.catalog.infrastructure.persistence.entities.ProductImageJpa;
import jakarta.persistence.*;
import java.util.ArrayList;
import java.util.List;
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

    @Column(name = "name", length = 200, nullable = false)
    private String name;

    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @JoinColumn(name = "product_id", nullable = false)
    @Builder.Default
    private List<ProductImageJpa> productImages = new ArrayList<>();
}
