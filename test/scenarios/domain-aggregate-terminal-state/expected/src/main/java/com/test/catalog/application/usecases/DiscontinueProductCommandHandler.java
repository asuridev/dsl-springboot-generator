package com.test.catalog.application.usecases;

import com.test.catalog.application.commands.DiscontinueProductCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-PRD-002]
@ApplicationComponent
public class DiscontinueProductCommandHandler implements CommandHandler<DiscontinueProductCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(DiscontinueProductCommand command) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
