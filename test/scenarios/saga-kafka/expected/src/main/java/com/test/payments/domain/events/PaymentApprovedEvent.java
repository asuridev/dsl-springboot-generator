package com.test.payments.domain.events;

import com.test.shared.domain.DomainEvent;
import com.test.shared.domain.EventMetadata;
import java.util.UUID;

/**
 * Domain event: PaymentApproved.
 * Immutable record representing something that happened in the payments bounded context.
 *
 * channel: payments.payment.approved
 * version: 1
 * derived_from: domainEvents.published.PaymentApproved
 */
public record PaymentApprovedEvent(EventMetadata metadata, UUID orderId) implements DomainEvent {}
