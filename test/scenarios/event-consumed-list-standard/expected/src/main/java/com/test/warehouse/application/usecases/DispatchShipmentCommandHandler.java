package com.test.warehouse.application.usecases;

import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import com.test.warehouse.application.commands.DispatchShipmentCommand;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[dispatch-shipment]
@ApplicationComponent
public class DispatchShipmentCommandHandler implements CommandHandler<DispatchShipmentCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(DispatchShipmentCommand command) {
        // 1. shipment.dispatch(...)

        // TODO: implement business logic — ver warehouse-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
