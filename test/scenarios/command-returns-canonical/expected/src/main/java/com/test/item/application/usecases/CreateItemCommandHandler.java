package com.test.item.application.usecases;

import com.test.item.application.commands.CreateItemCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.ReturningCommandHandler;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[create-item]
@ApplicationComponent
public class CreateItemCommandHandler implements ReturningCommandHandler<CreateItemCommand, UUID> {

    @Override
    @Transactional
    @LogExceptions
    public UUID handle(CreateItemCommand command) {
        // TODO: implement business logic — ver item-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
