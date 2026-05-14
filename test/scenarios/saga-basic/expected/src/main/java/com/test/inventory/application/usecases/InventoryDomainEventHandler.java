package com.test.inventory.application.usecases;

import com.test.inventory.application.events.StockReservationFailedIntegrationEvent;
import com.test.inventory.application.events.StockReservedIntegrationEvent;
import com.test.inventory.application.ports.MessageBroker;
import com.test.inventory.domain.events.StockReservationFailedEvent;
import com.test.inventory.domain.events.StockReservedEvent;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.SagaStep;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * InventoryDomainEventHandler — Domain Event Bridge
 *

 * Connects the internal Spring event bus (ApplicationEventPublisher) with
 * the external messaging port ({@link MessageBroker}).
 *
 * AFTER_COMMIT guarantees that external events are published only when the
 * database transaction committed successfully, preventing ghost events from
 * rolled-back operations.

 */
@ApplicationComponent
public class InventoryDomainEventHandler {

    private final MessageBroker messageBroker;

    public InventoryDomainEventHandler(MessageBroker messageBroker) {
        this.messageBroker = messageBroker;
    }

    /**
     * Handles {@link StockReservedEvent} after the wrapping transaction commits.
     * derived_from: domainEvents.published.StockReserved
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @SagaStep(saga = "CheckoutSaga", order = 1, event = "StockReserved", role = SagaStep.Role.SUCCESS)
    public void onStockReservedEvent(StockReservedEvent event) {
        messageBroker.publishStockReservedIntegrationEvent(
            new StockReservedIntegrationEvent(event.metadata(), event.orderId())
        );
    }

    /**
     * Handles {@link StockReservationFailedEvent} after the wrapping transaction commits.
     * derived_from: domainEvents.published.StockReservationFailed
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @SagaStep(saga = "CheckoutSaga", order = 1, event = "StockReservationFailed", role = SagaStep.Role.FAILURE)
    public void onStockReservationFailedEvent(StockReservationFailedEvent event) {
        messageBroker.publishStockReservationFailedIntegrationEvent(
            new StockReservationFailedIntegrationEvent(event.metadata(), event.orderId())
        );
    }
}
