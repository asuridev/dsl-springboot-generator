package com.test.catalog.application.usecases;

import com.test.catalog.application.commands.ValidateProductsAndPricesCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[validate-products-and-prices]
@ApplicationComponent
public class ValidateProductsAndPricesCommandHandler implements CommandHandler<ValidateProductsAndPricesCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(ValidateProductsAndPricesCommand command) {
        // 1. product.validate(...)

        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
