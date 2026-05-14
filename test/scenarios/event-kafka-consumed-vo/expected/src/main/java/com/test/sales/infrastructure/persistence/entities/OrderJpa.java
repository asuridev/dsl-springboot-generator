package com.test.sales.infrastructure.persistence.entities;

import com.test.sales.domain.enums.OrderStatus;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.util.UUID;
import lombok.*;

/**
 * OrderJpa — JPA Entity for Order aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "orders")
public class OrderJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "total_amount_amount", precision = 19, scale = 4)
    private BigDecimal totalAmountAmount;

    @Column(name = "total_amount_currency", length = 3)
    private String totalAmountCurrency;

    @Column(name = "status")
    @Enumerated(EnumType.STRING)
    private OrderStatus status;
}
