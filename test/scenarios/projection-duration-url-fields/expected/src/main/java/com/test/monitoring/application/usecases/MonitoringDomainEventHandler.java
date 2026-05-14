package com.test.monitoring.application.usecases;

import com.test.monitoring.application.events.ServiceCheckCompletedIntegrationEvent;
import com.test.monitoring.application.events.ServiceLatencyUpdatedIntegrationEvent;
import com.test.monitoring.application.ports.MessageBroker;
import com.test.monitoring.domain.events.ServiceCheckCompletedEvent;
import com.test.monitoring.domain.events.ServiceLatencyUpdatedEvent;
import com.test.shared.domain.annotations.ApplicationComponent;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * MonitoringDomainEventHandler — Domain Event Bridge
 *

 * Connects the internal Spring event bus (ApplicationEventPublisher) with
 * the external messaging port ({@link MessageBroker}).
 *
 * AFTER_COMMIT guarantees that external events are published only when the
 * database transaction committed successfully, preventing ghost events from
 * rolled-back operations.

 */
@ApplicationComponent
public class MonitoringDomainEventHandler {

    private final MessageBroker messageBroker;

    public MonitoringDomainEventHandler(MessageBroker messageBroker) {
        this.messageBroker = messageBroker;
    }

    /**
     * Handles {@link ServiceCheckCompletedEvent} after the wrapping transaction commits.
     * derived_from: domainEvents.published.ServiceCheckCompleted
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onServiceCheckCompletedEvent(ServiceCheckCompletedEvent event) {
        messageBroker.publishServiceCheckCompletedIntegrationEvent(
            new ServiceCheckCompletedIntegrationEvent(
                event.metadata(),
                event.serviceId(),
                event.averageLatency(),
                event.dashboardUrl(),
                event.score()
            )
        );
    }

    /**
     * Handles {@link ServiceLatencyUpdatedEvent} after the wrapping transaction commits.
     * derived_from: domainEvents.published.ServiceLatencyUpdated
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onServiceLatencyUpdatedEvent(ServiceLatencyUpdatedEvent event) {
        messageBroker.publishServiceLatencyUpdatedIntegrationEvent(
            new ServiceLatencyUpdatedIntegrationEvent(
                event.metadata(),
                event.serviceId(),
                event.averageLatency(),
                event.score()
            )
        );
    }
}
