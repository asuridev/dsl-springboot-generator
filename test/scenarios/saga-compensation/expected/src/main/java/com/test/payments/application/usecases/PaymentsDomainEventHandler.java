package com.test.payments.application.usecases;

import com.test.payments.application.events.PaymentApprovedIntegrationEvent;
import com.test.payments.application.events.PaymentFailedIntegrationEvent;
import com.test.payments.application.ports.MessageBroker;
import com.test.payments.domain.events.PaymentApprovedEvent;
import com.test.payments.domain.events.PaymentFailedEvent;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.SagaStep;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * PaymentsDomainEventHandler — Domain Event Bridge
 *

 * Connects the internal Spring event bus (ApplicationEventPublisher) with
 * the external messaging port ({@link MessageBroker}).
 *
 * AFTER_COMMIT guarantees that external events are published only when the
 * database transaction committed successfully, preventing ghost events from
 * rolled-back operations.

 */
@ApplicationComponent
public class PaymentsDomainEventHandler {

    private final MessageBroker messageBroker;

    public PaymentsDomainEventHandler(MessageBroker messageBroker) {
        this.messageBroker = messageBroker;
    }

    /**
     * Handles {@link PaymentApprovedEvent} after the wrapping transaction commits.
     * derived_from: domainEvents.published.PaymentApproved
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @SagaStep(saga = "FulfillmentSaga", order = 2, event = "PaymentApproved", role = SagaStep.Role.SUCCESS)
    public void onPaymentApprovedEvent(PaymentApprovedEvent event) {
        messageBroker.publishPaymentApprovedIntegrationEvent(
            new PaymentApprovedIntegrationEvent(event.metadata(), event.orderId())
        );
    }

    /**
     * Handles {@link PaymentFailedEvent} after the wrapping transaction commits.
     * derived_from: domainEvents.published.PaymentFailed
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @SagaStep(saga = "FulfillmentSaga", order = 2, event = "PaymentFailed", role = SagaStep.Role.FAILURE)
    public void onPaymentFailedEvent(PaymentFailedEvent event) {
        messageBroker.publishPaymentFailedIntegrationEvent(
            new PaymentFailedIntegrationEvent(event.metadata(), event.orderId())
        );
    }
}
