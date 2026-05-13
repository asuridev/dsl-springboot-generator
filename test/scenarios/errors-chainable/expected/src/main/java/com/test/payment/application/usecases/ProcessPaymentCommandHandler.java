package com.test.payment.application.usecases;

import com.test.payment.application.commands.ProcessPaymentCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.ReturningCommandHandler;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[process-payment]
@ApplicationComponent
public class ProcessPaymentCommandHandler implements ReturningCommandHandler<ProcessPaymentCommand, UUID> {

    @Override
    @Transactional
    @LogExceptions
    public UUID handle(ProcessPaymentCommand command) {
        // TODO: implement business logic — ver payment-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
