package com.test.catalog.application.usecases;

import com.test.catalog.application.commands.UpdateItemCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-CAT-003]
@ApplicationComponent
public class UpdateItemCommandHandler implements CommandHandler<UpdateItemCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(UpdateItemCommand command) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
