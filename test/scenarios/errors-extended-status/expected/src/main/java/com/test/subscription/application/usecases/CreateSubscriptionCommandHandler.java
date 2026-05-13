package com.test.subscription.application.usecases;

import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.ReturningCommandHandler;
import com.test.subscription.application.commands.CreateSubscriptionCommand;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[create-subscription]
@ApplicationComponent
public class CreateSubscriptionCommandHandler implements ReturningCommandHandler<CreateSubscriptionCommand, UUID> {

    @Override
    @Transactional
    @LogExceptions
    public UUID handle(CreateSubscriptionCommand command) {
        // TODO: implement business logic — ver subscription-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
