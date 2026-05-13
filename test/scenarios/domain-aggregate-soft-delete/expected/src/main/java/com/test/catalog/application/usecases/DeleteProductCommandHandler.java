package com.test.catalog.application.usecases;

import com.test.catalog.application.commands.DeleteProductCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-PRD-002]
@ApplicationComponent
public class DeleteProductCommandHandler implements CommandHandler<DeleteProductCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(DeleteProductCommand command) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
