package com.test.catalog.application.usecases;

import com.test.catalog.application.commands.CreateTagCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.ReturningCommandHandler;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-TAG-001]
@ApplicationComponent
public class CreateTagCommandHandler implements ReturningCommandHandler<CreateTagCommand, UUID> {

    @Override
    @Transactional
    @LogExceptions
    public UUID handle(CreateTagCommand command) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
