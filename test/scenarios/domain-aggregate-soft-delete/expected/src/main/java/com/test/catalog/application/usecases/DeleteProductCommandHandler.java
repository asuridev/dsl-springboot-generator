package com.test.catalog.application.usecases;

import com.test.catalog.application.commands.DeleteProductCommand;
import com.test.catalog.domain.repository.ProductRepository;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-PRD-002]
@ApplicationComponent
public class DeleteProductCommandHandler implements CommandHandler<DeleteProductCommand> {

    private final ProductRepository productRepository;

    public DeleteProductCommandHandler(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    @Override
    @Transactional
    @LogExceptions
    public void handle(DeleteProductCommand command) {
        // 1. Load Product via productRepository.findById(...) (throws ProductNotFoundError)
        // 2. product.softDelete(...)
        // 3. productRepository.save(product)

        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
