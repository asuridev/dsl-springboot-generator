package com.test.orders.application.usecases;

import com.test.orders.application.events.OrderPlacedIntegrationEvent;
import com.test.orders.application.ports.MessageBroker;
import com.test.orders.domain.events.OrderPlacedEvent;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.SagaStep;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * OrdersDomainEventHandler — Domain Event Bridge
 *

 * Connects the internal Spring event bus (ApplicationEventPublisher) with
 * the external messaging port ({@link MessageBroker}).
 *
 * AFTER_COMMIT guarantees that external events are published only when the
 * database transaction committed successfully, preventing ghost events from
 * rolled-back operations.

 */
@ApplicationComponent
public class OrdersDomainEventHandler {

    private final MessageBroker messageBroker;

    public OrdersDomainEventHandler(MessageBroker messageBroker) {
        this.messageBroker = messageBroker;
    }

    /**
     * Handles {@link OrderPlacedEvent} after the wrapping transaction commits.
     * derived_from: domainEvents.published.OrderPlaced
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @SagaStep(saga = "CheckoutSaga", order = 0, event = "OrderPlaced", role = SagaStep.Role.TRIGGER)
    public void onOrderPlacedEvent(OrderPlacedEvent event) {
        messageBroker.publishOrderPlacedIntegrationEvent(
            new OrderPlacedIntegrationEvent(event.metadata(), event.orderId(), event.customerId())
        );
    }
}
