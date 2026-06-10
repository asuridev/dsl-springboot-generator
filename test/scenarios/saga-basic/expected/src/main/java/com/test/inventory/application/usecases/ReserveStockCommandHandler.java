package com.test.inventory.application.usecases;

import com.test.inventory.application.commands.ReserveStockCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[reserve-stock]
@ApplicationComponent
public class ReserveStockCommandHandler implements CommandHandler<ReserveStockCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(ReserveStockCommand command) {
        // 1. stockItem.reserve(...)

        // TODO: implement business logic — ver inventory-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
