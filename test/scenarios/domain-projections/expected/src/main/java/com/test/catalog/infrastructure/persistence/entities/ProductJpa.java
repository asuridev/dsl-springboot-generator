package com.test.catalog.infrastructure.persistence.entities;

import com.test.catalog.domain.enums.ProductStatus;
import jakarta.persistence.*;
import java.math.BigDecimal;
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

    @Column(name = "status")
    @Enumerated(EnumType.STRING)
    private ProductStatus status;

    @Column(name = "price_amount", precision = 19, scale = 4)
    private BigDecimal priceAmount;

    @Column(name = "price_currency", length = 3)
    private String priceCurrency;
}
