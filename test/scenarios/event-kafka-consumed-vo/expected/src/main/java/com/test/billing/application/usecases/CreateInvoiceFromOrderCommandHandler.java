package com.test.billing.application.usecases;

import com.test.billing.application.commands.CreateInvoiceFromOrderCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[create-invoice-from-order]
@ApplicationComponent
public class CreateInvoiceFromOrderCommandHandler implements CommandHandler<CreateInvoiceFromOrderCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(CreateInvoiceFromOrderCommand command) {
        // 1. invoice.process(...)

        // TODO: implement business logic — ver billing-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
