package com.test.ordering.application.usecases;

import com.test.ordering.application.commands.ProcessPlacedOrderCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[process-placed-order]
@ApplicationComponent
public class ProcessPlacedOrderCommandHandler implements CommandHandler<ProcessPlacedOrderCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(ProcessPlacedOrderCommand command) {
        // TODO: implement business logic — ver ordering-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
