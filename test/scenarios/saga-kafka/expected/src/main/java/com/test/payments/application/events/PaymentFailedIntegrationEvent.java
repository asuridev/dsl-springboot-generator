package com.test.payments.application.events;

import com.test.shared.domain.EventMetadata;
import java.util.UUID;

/**
 * Integration Event — broker-side projection of the {@link com.test.payments.domain.events.PaymentFailedEvent} domain event.
 *
 * Intentionally decoupled from the domain event so that changes in broker
 * technology or serialization format never affect the domain model.
 *
 * channel: payments.payment.failed
 * version: 1
 * derived_from: domainEvents.published.PaymentFailed
 */
public record PaymentFailedIntegrationEvent(EventMetadata metadata, UUID orderId) {}
