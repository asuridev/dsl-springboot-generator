package com.test.ordering.application.usecases;

import com.test.ordering.application.commands.RemoveOrderLineCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-ORD-003]
@ApplicationComponent
public class RemoveOrderLineCommandHandler implements CommandHandler<RemoveOrderLineCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(RemoveOrderLineCommand command) {
        // TODO: implement business logic — ver ordering-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
