package com.test.invoice.infrastructure.persistence.entities;

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

    @Column(name = "number", length = 30, nullable = false)
    private String number;

    @Column(name = "amount", precision = 12, scale = 2)
    private BigDecimal amount;
}
