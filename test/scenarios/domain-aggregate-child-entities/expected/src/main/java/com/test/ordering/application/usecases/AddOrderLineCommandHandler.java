package com.test.ordering.application.usecases;

import com.test.ordering.application.commands.AddOrderLineCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-ORD-002]
@ApplicationComponent
public class AddOrderLineCommandHandler implements CommandHandler<AddOrderLineCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(AddOrderLineCommand command) {
        // TODO: implement business logic — ver ordering-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
