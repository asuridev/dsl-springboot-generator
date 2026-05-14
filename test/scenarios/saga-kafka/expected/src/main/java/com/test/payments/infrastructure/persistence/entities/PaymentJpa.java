package com.test.payments.infrastructure.persistence.entities;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.util.UUID;
import lombok.*;

/**
 * PaymentJpa — JPA Entity for Payment aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "payments")
public class PaymentJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "order_id")
    private UUID orderId;

    @Column(name = "amount", precision = 10, scale = 2)
    private BigDecimal amount;
}
