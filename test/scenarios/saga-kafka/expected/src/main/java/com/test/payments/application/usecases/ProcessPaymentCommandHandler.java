package com.test.payments.application.usecases;

import com.test.payments.application.commands.ProcessPaymentCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[process-payment]
@ApplicationComponent
public class ProcessPaymentCommandHandler implements CommandHandler<ProcessPaymentCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(ProcessPaymentCommand command) {
        // 1. payment.process(...)

        // TODO: implement business logic — ver payments-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
