package com.test.catalog.application.usecases;

import com.test.catalog.application.events.StockInitializedIntegrationEvent;
import com.test.catalog.application.events.StockReservedIntegrationEvent;
import com.test.catalog.application.ports.MessageBroker;
import com.test.catalog.domain.events.StockInitializedEvent;
import com.test.catalog.domain.events.StockReservedEvent;
import com.test.shared.domain.annotations.ApplicationComponent;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * CatalogDomainEventHandler — Domain Event Bridge
 *

 * Connects the internal Spring event bus (ApplicationEventPublisher) with
 * the external messaging port ({@link MessageBroker}).
 *
 * AFTER_COMMIT guarantees that external events are published only when the
 * database transaction committed successfully, preventing ghost events from
 * rolled-back operations.

 */
@ApplicationComponent
public class CatalogDomainEventHandler {

    private final MessageBroker messageBroker;

    public CatalogDomainEventHandler(MessageBroker messageBroker) {
        this.messageBroker = messageBroker;
    }

    /**
     * Handles {@link StockInitializedEvent} after the wrapping transaction commits.
     * derived_from: domainEvents.published.StockInitialized
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onStockInitializedEvent(StockInitializedEvent event) {
        messageBroker.publishStockInitializedIntegrationEvent(
            new StockInitializedIntegrationEvent(
                event.metadata(),
                event.productId(),
                event.quantity(),
                event.reservedQuantity(),
                event.unitCost()
            )
        );
    }

    /**
     * Handles {@link StockReservedEvent} after the wrapping transaction commits.
     * derived_from: domainEvents.published.StockReserved
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onStockReservedEvent(StockReservedEvent event) {
        messageBroker.publishStockReservedIntegrationEvent(
            new StockReservedIntegrationEvent(event.metadata(), event.productId(), event.reservedQuantity())
        );
    }
}
