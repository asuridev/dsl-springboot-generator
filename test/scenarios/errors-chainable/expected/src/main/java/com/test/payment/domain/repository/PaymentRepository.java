package com.test.payment.domain.repository;

import com.test.payment.domain.aggregate.Payment;
import java.util.Optional;
import java.util.UUID;

/**
 * PaymentRepository — Domain repository port (output port).
 * Defines the persistence contract for the Payment aggregate.
 * Implementations live in the infrastructure layer.
 */
public interface PaymentRepository {
    Payment save(Payment payment);

    Optional<Payment> findById(UUID id);
}
