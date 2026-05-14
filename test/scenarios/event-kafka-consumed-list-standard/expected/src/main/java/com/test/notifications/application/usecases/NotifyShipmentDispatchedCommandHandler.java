package com.test.notifications.application.usecases;

import com.test.notifications.application.commands.NotifyShipmentDispatchedCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[notify-shipment-dispatched]
@ApplicationComponent
public class NotifyShipmentDispatchedCommandHandler implements CommandHandler<NotifyShipmentDispatchedCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(NotifyShipmentDispatchedCommand command) {
        // TODO: implement business logic — ver notifications-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
