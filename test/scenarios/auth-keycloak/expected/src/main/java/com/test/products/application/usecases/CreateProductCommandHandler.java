package com.test.products.application.usecases;

import com.test.products.application.commands.CreateProductCommand;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-PRD-001]
@ApplicationComponent
public class CreateProductCommandHandler implements CommandHandler<CreateProductCommand> {

    @Override
    @Transactional
    @LogExceptions
    public void handle(CreateProductCommand command) {
        // 1. Build the Product aggregate (Product.create(...) / new Product(...))

        // TODO: implement business logic — ver products-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
