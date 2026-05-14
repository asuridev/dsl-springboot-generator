package com.test.warehouse.application.usecases;

import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.warehouse.application.events.ShipmentDispatchedIntegrationEvent;
import com.test.warehouse.application.ports.MessageBroker;
import com.test.warehouse.domain.events.ShipmentDispatchedEvent;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * WarehouseDomainEventHandler — Domain Event Bridge
 *

 * Connects the internal Spring event bus (ApplicationEventPublisher) with
 * the external messaging port ({@link MessageBroker}).
 *
 * AFTER_COMMIT guarantees that external events are published only when the
 * database transaction committed successfully, preventing ghost events from
 * rolled-back operations.

 */
@ApplicationComponent
public class WarehouseDomainEventHandler {

    private final MessageBroker messageBroker;

    public WarehouseDomainEventHandler(MessageBroker messageBroker) {
        this.messageBroker = messageBroker;
    }

    /**
     * Handles {@link ShipmentDispatchedEvent} after the wrapping transaction commits.
     * derived_from: domainEvents.published.ShipmentDispatched
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onShipmentDispatchedEvent(ShipmentDispatchedEvent event) {
        messageBroker.publishShipmentDispatchedIntegrationEvent(
            new ShipmentDispatchedIntegrationEvent(
                event.metadata(),
                event.shipmentId(),
                event.productIds(),
                event.checkpointTimes()
            )
        );
    }
}
