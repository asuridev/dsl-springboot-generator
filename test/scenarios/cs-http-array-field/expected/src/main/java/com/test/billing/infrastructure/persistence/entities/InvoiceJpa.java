package com.test.billing.infrastructure.persistence.entities;

import jakarta.persistence.*;
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
}
