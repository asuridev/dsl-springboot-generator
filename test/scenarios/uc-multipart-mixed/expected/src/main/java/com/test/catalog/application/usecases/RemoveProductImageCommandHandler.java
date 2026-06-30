package com.test.catalog.application.usecases;

import com.test.catalog.application.commands.RemoveProductImageCommand;
import com.test.catalog.application.ports.ProductMediaStoragePort;
import com.test.catalog.domain.repository.ProductRepository;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-CAT-012]
@ApplicationComponent
public class RemoveProductImageCommandHandler implements CommandHandler<RemoveProductImageCommand> {

    private final ProductRepository productRepository;

    private final ProductMediaStoragePort productMediaStoragePort;

    public RemoveProductImageCommandHandler(
        ProductRepository productRepository,
        ProductMediaStoragePort productMediaStoragePort
    ) {
        this.productRepository = productRepository;

        this.productMediaStoragePort = productMediaStoragePort;
    }

    @Override
    @Transactional
    @LogExceptions
    public void handle(RemoveProductImageCommand command) {
        // storage delete → product-media (derived_from: storageCalls[product-media:delete])
        String productMediaStorageKey = null; // TODO useCase(UC-CAT-012, storageCalls): resolve storageKey from the loaded aggregate
        productMediaStoragePort.delete(productMediaStorageKey);

        // 1. Load Product via productRepository.findById(...) (throws ProductNotFoundError)
        // 2. product.removeImage(...)
        // 3. productRepository.save(product)

        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
