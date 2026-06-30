package com.test.catalog.application.usecases;

import com.test.catalog.application.commands.AddProductImageCommand;
import com.test.catalog.application.ports.ProductMediaStoragePort;
import com.test.catalog.domain.repository.ProductRepository;
import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.LogExceptions;
import com.test.shared.domain.interfaces.CommandHandler;
import org.springframework.transaction.annotation.Transactional;

// derived_from: useCases[UC-CAT-011]
@ApplicationComponent
public class AddProductImageCommandHandler implements CommandHandler<AddProductImageCommand> {

    private final ProductRepository productRepository;

    private final ProductMediaStoragePort productMediaStoragePort;

    public AddProductImageCommandHandler(
        ProductRepository productRepository,
        ProductMediaStoragePort productMediaStoragePort
    ) {
        this.productRepository = productRepository;

        this.productMediaStoragePort = productMediaStoragePort;
    }

    @Override
    @Transactional
    @LogExceptions
    public void handle(AddProductImageCommand command) {
        // storage put → product-media (derived_from: storageCalls[product-media:put])
        com.test.shared.domain.valueobject.StoredObject media = productMediaStoragePort.put(command.file());

        // 1. Load Product via productRepository.findById(...) (throws ProductNotFoundError)
        // 2. product.addImage(...)
        // 3. productRepository.save(product)

        // TODO: implement business logic — ver catalog-flows.md
        throw new UnsupportedOperationException("Not implemented yet");
    }
}
