package com.test.inventory.application.usecases;

import com.test.inventory.application.commands.ReleaseStockCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[release-stock]
@ApplicationComponent
public class ReleaseStockCommandHandler implements CommandHandler<ReleaseStockCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(ReleaseStockCommand command) {
        // 1. stockItem.release(...)

        // TODO: implement business logic — ver inventory-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
