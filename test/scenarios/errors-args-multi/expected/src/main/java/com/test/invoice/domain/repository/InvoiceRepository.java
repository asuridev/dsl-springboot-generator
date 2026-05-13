package com.test.invoice.domain.repository;

import com.test.invoice.domain.aggregate.Invoice;
import java.util.Optional;
import java.util.UUID;

/**
 * InvoiceRepository — Domain repository port (output port).
 * Defines the persistence contract for the Invoice aggregate.
 * Implementations live in the infrastructure layer.
 */
public interface InvoiceRepository {
    Invoice save(Invoice invoice);

    Optional<Invoice> findById(UUID id);
}
