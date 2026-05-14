package com.test.calendar.application.usecases;

import com.test.calendar.application.events.SlotCapacityPublishedIntegrationEvent;
import com.test.calendar.application.ports.MessageBroker;
import com.test.calendar.domain.events.SlotCapacityPublishedEvent;
import com.test.shared.domain.annotations.ApplicationComponent;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * CalendarDomainEventHandler — Domain Event Bridge
 *

 * Connects the internal Spring event bus (ApplicationEventPublisher) with
 * the external messaging port ({@link MessageBroker}).
 *
 * AFTER_COMMIT guarantees that external events are published only when the
 * database transaction committed successfully, preventing ghost events from
 * rolled-back operations.

 */
@ApplicationComponent
public class CalendarDomainEventHandler {

    private final MessageBroker messageBroker;

    public CalendarDomainEventHandler(MessageBroker messageBroker) {
        this.messageBroker = messageBroker;
    }

    /**
     * Handles {@link SlotCapacityPublishedEvent} after the wrapping transaction commits.
     * derived_from: domainEvents.published.SlotCapacityPublished
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onSlotCapacityPublishedEvent(SlotCapacityPublishedEvent event) {
        messageBroker.publishSlotCapacityPublishedIntegrationEvent(
            new SlotCapacityPublishedIntegrationEvent(
                event.metadata(),
                event.date(),
                event.totalSlots(),
                event.bookedSlots()
            )
        );
    }
}
