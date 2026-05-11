package com.test.catalog.application.usecases;

import com.test.catalog.application.events.ProductActivatedIntegrationEvent;
import com.test.catalog.application.events.ProductPriceChangedIntegrationEvent;
import com.test.catalog.application.ports.MessageBroker;
import com.test.catalog.domain.events.ProductActivatedEvent;
import com.test.catalog.domain.events.ProductPriceChangedEvent;
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
     * Handles {@link ProductActivatedEvent} after the wrapping transaction commits.
     * derived_from: domainEvents.published.ProductActivated
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onProductActivatedEvent(ProductActivatedEvent event) {
        messageBroker.publishProductActivatedIntegrationEvent(
            new ProductActivatedIntegrationEvent(
                event.metadata(),
                event.productId(),
                event.productName(),
                event.price()
            )
        );
    }

    /**
     * Handles {@link ProductPriceChangedEvent} after the wrapping transaction commits.
     * derived_from: domainEvents.published.ProductPriceChanged
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onProductPriceChangedEvent(ProductPriceChangedEvent event) {
        messageBroker.publishProductPriceChangedIntegrationEvent(
            new ProductPriceChangedIntegrationEvent(event.metadata(), event.productId(), event.newPrice())
        );
    }
}
