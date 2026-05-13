package com.test.ordering.application.usecases;

import com.test.ordering.application.commands.CreateOrderCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.ReturningCommandHandler;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-ORD-001]
@ApplicationComponent
public class CreateOrderCommandHandler implements ReturningCommandHandler<CreateOrderCommand, UUID> {

    @Override
    @Transactional
    @LogExceptions
    public UUID handle(CreateOrderCommand command) {
        // TODO: implement business logic — ver ordering-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
