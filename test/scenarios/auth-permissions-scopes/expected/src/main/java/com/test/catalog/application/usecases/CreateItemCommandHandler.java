package com.test.catalog.application.usecases;

import com.test.catalog.application.commands.CreateItemCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-CAT-002]
@ApplicationComponent
public class CreateItemCommandHandler implements CommandHandler<CreateItemCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(CreateItemCommand command) {
        // 1. Build the Item aggregate (Item.create(...) / new Item(...))

        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
