package com.test.billing.infrastructure.persistence.entities;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.util.UUID;
import lombok.*;

/**
 * InvoiceJpa — JPA Entity for Invoice aggregate.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "invoices")
public class InvoiceJpa {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "order_id")
    private UUID orderId;

    @Column(name = "total_amount_amount", precision = 19, scale = 4)
    private BigDecimal totalAmountAmount;

    @Column(name = "total_amount_currency", length = 3)
    private String totalAmountCurrency;
}
