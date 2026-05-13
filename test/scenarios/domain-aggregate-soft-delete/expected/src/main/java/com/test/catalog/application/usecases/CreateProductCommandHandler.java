package com.test.catalog.application.usecases;

import com.test.catalog.application.commands.CreateProductCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.ReturningCommandHandler;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-PRD-001]
@ApplicationComponent
public class CreateProductCommandHandler implements ReturningCommandHandler<CreateProductCommand, UUID> {

    @Override
    @Transactional
    @LogExceptions
    public UUID handle(CreateProductCommand command) {
        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
