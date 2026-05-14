package com.test.payments.domain.events;

import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.util.UUID;

/**
 * Domain event: PaymentFailed.
 * Immutable record representing something that happened in the payments bounded context.
 *
 * channel: payments.payment.failed
 * version: 1
 * derived_from: domainEvents.published.PaymentFailed
 */
public record PaymentFailedEvent(EventMetadata metadata, UUID orderId) implements DomainEvent {}
