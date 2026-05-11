package com.test.sales.application.usecases;

import com.test.sales.application.events.OrderPlacedIntegrationEvent;
import com.test.sales.application.ports.MessageBroker;
import com.test.sales.domain.events.OrderPlacedEvent;
import com.test.shared.domain.annotations.ApplicationComponent;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * SalesDomainEventHandler — Domain Event Bridge
 *

 * Connects the internal Spring event bus (ApplicationEventPublisher) with
 * the external messaging port ({@link MessageBroker}).
 *
 * AFTER_COMMIT guarantees that external events are published only when the
 * database transaction committed successfully, preventing ghost events from
 * rolled-back operations.

 */
@ApplicationComponent
public class SalesDomainEventHandler {

    private final MessageBroker messageBroker;

    public SalesDomainEventHandler(MessageBroker messageBroker) {
        this.messageBroker = messageBroker;
    }

    /**
     * Handles {@link OrderPlacedEvent} after the wrapping transaction commits.
     * derived_from: domainEvents.published.OrderPlaced
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOrderPlacedEvent(OrderPlacedEvent event) {
        messageBroker.publishOrderPlacedIntegrationEvent(
            new OrderPlacedIntegrationEvent(event.metadata(), event.orderId(), event.buyerId(), event.lines())
        );
    }
}
