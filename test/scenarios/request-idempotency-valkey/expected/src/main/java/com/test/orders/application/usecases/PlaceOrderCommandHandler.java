package com.test.orders.application.usecases;

import com.test.orders.application.commands.PlaceOrderCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-ORD-001]
@ApplicationComponent
public class PlaceOrderCommandHandler implements CommandHandler<PlaceOrderCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(PlaceOrderCommand command) {
        // 1. order.place(...)

        // TODO: implement business logic — ver orders-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
