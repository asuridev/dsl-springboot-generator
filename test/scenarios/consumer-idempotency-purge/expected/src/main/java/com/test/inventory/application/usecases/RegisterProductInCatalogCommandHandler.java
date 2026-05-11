package com.test.inventory.application.usecases;

import com.test.inventory.application.commands.RegisterProductInCatalogCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[register-product-in-catalog]
@ApplicationComponent
public class RegisterProductInCatalogCommandHandler implements CommandHandler<RegisterProductInCatalogCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(RegisterProductInCatalogCommand command) {
        // TODO: implement business logic — ver inventory-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
